import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser, Page } from "puppeteer-core";
import { log, repoRoot, wordsToSrt } from "@avatar/pipeline";
import type { Performance, AllConfig } from "@avatar/shared";
import { launchChrome } from "./chrome.js";
import { FORMAT_EXT, FORMAT_TRANSPARENT, startEncoder, type OutputFormat } from "./ffmpeg.js";
import { startServer } from "./server.js";

export interface RenderOptions {
  projectDir: string;
  format: OutputFormat;
  /** Fichier de sortie (défaut : <projet>/sortie.<ext>). */
  out?: string;
  /** Extrait à rendre, en secondes. */
  debut?: number;
  fin?: number;
  /** Écrit aussi chaque image PNG dans ce dossier. */
  framesDir?: string;
  root?: string;
  chromePath?: string;
  /** Force le rendu logiciel (SwiftShader). */
  software?: boolean;
  /** Ne pas encoder (utile pour les tests de déterminisme). */
  skipEncode?: boolean;
  onProgress?: (done: number, total: number) => void;
  quiet?: boolean;
  /** Rendu brouillon : résolution divisée par ce facteur (2 = quatre fois plus rapide). */
  scale?: number;
  /** Écrit aussi les sous-titres SRT (mots horodatés) à côté de la vidéo. */
  srt?: boolean;
  /** Annulation (studio). */
  signal?: AbortSignal;
}

export interface RenderResult {
  output?: string;
  frames: number;
  duration: number;
  /** SHA-256 de chaque image (ordre des images). */
  hashes: string[];
  report: unknown;
}

export interface OpenedPage {
  browser: Browser;
  page: Page;
  performance: Performance;
  config: AllConfig;
  report: Record<string, unknown>;
  close(): Promise<void>;
}

/** Démarre serveur + Chrome, charge la page et le projet. */
export async function openProject(o: { projectDir: string; root?: string; chromePath?: string; software?: boolean; transparent?: boolean; scale?: number }): Promise<OpenedPage> {
  const root = o.root ?? repoRoot();
  const server = await startServer({ projectDir: o.projectDir, root, background: o.transparent ? "transparent" : "green" });
  const payload = server.payload() as { performance: Performance; config: AllConfig; modelUrl?: string; modelPath: string };
  if (o.scale && o.scale !== 1) {
    const k = 1 / o.scale;
    const b = payload.config.scene.bubble;
    const even = (v: number) => Math.max(2, Math.round((v * k) / 2) * 2);
    payload.config.scene.resolution = { width: even(payload.config.scene.resolution.width), height: even(payload.config.scene.resolution.height) };
    b.margin = Math.round(b.margin * k);
    if (b.diameter !== "auto") b.diameter = Math.round(b.diameter * k);
    b.ring.width = Math.max(1, Math.round(b.ring.width * k));
    b.position = { x: b.position.x === "center" ? "center" : Math.round(b.position.x * k), y: b.position.y === "center" ? "center" : Math.round(b.position.y * k) };
  }
  if (!payload.modelUrl) log.warn(`Modèle ${payload.modelPath} introuvable : rendu avec le personnage de substitution.`);
  const browser = await launchChrome({ executablePath: o.chromePath, gpu: o.software ? false : undefined });
  const page = await browser.newPage();
  const { width, height } = payload.config.scene.resolution;
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => log.error(`page : ${(e as Error).message}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warn") log.warn(`page : ${m.text()}`);
  });
  await page.goto(`${server.url}/index.html?mode=render`, { waitUntil: "load" });
  await page.evaluate(() => window.avatarReady);
  const report = (await page.evaluate((data) => window.loadProject(data as never), payload as never)) as Record<string, unknown>;
  return {
    browser,
    page,
    performance: payload.performance,
    config: payload.config,
    report,
    close: async () => {
      await browser.close().catch(() => undefined);
      await server.close();
    },
  };
}

function printReport(report: Record<string, unknown>): void {
  log.info(`WebGL : ${report.renderer}${report.software ? " (rendu logiciel, lent)" : ""}`);
  log.info(`modèle : ${report.model} ; blendshapes ARKit : ${(report.blendshapesFound as string[]).length}/52 ; os : ${Object.keys(report.bonesFound as object).length} ; gestes : ${report.gestureSource}`);
  for (const w of report.warnings as string[]) log.warn(w);
}

/** `avatar render` : boucle image par image, capture PNG, encodage ffmpeg. */
export async function renderProject(o: RenderOptions): Promise<RenderResult> {
  const transparent = FORMAT_TRANSPARENT[o.format];
  const opened = await openProject({ projectDir: o.projectDir, root: o.root, chromePath: o.chromePath, software: o.software, transparent, scale: o.scale });
  try {
    if (!o.quiet) printReport(opened.report);
    const { performance: perf, config } = opened;
    const fps = perf.fps;
    const start = Math.max(0, o.debut ?? 0);
    const end = Math.min(perf.duration, o.fin ?? perf.duration);
    if (end <= start) throw new Error(`Extrait vide : --debut ${start} >= --fin ${end}`);
    const firstFrame = Math.round(start * fps);
    const lastFrame = Math.ceil(end * fps); // exclus
    const total = lastFrame - firstFrame;
    const { width, height } = config.scene.resolution;
    const output = o.out ?? path.join(path.resolve(o.projectDir), `sortie${FORMAT_EXT[o.format]}`);
    const audio = path.join(path.resolve(o.projectDir), perf.audio);
    if (!existsSync(audio)) throw new Error(`Audio introuvable : ${audio}`);
    if (o.framesDir) mkdirSync(o.framesDir, { recursive: true });

    // encodage vers un fichier temporaire : la sortie précédente n'est remplacée qu'en cas de succès
    const tmpOutput = output.replace(/(\.[^.]+)$/, ".partiel$1");
    const encoder = o.skipEncode ? undefined : startEncoder({ format: o.format, fps, audio, output: tmpOutput, start: firstFrame / fps, end: lastFrame / fps });
    let finished = false;
    const hashes: string[] = [];
    const t0 = Date.now();
    try {
    for (let n = firstFrame; n < lastFrame; n++) {
      if (o.signal?.aborted) throw new Error("Rendu annulé");
      const t = n / fps;
      await opened.page.evaluate((tt) => window.renderFrame(tt), t);
      const png = Buffer.from(await opened.page.screenshot({ type: "png", omitBackground: transparent, clip: { x: 0, y: 0, width, height }, captureBeyondViewport: false, optimizeForSpeed: true }));
      hashes.push(createHash("sha256").update(png).digest("hex"));
      if (o.framesDir) writeFileSync(path.join(o.framesDir, `${String(n).padStart(6, "0")}.png`), png);
      if (encoder) await encoder.write(png);
      const done = n - firstFrame + 1;
      o.onProgress?.(done, total);
      if (!o.quiet && (done % 5 === 0 || done === total)) {
        const elapsed = (Date.now() - t0) / 1000;
        const eta = (elapsed / done) * (total - done);
        const bar = "█".repeat(Math.round((done / total) * 30)).padEnd(30, "░");
        process.stderr.write(`\r  [${bar}] ${done}/${total} images  ${(done / elapsed).toFixed(1)} i/s  reste ~${Math.round(eta)} s   `);
      }
    }
    if (!o.quiet) process.stderr.write("\n");
    if (encoder) {
      log.info("Encodage final…");
      await encoder.finish();
      renameSync(tmpOutput, output);
      log.done(`Vidéo écrite : ${output} (${total} images, ${(total / fps).toFixed(2)} s)`);
    }
    finished = true;
    } finally {
      if (!finished) cleanupEncoder(encoder, tmpOutput);
    }
    if (o.srt) {
      const srtFile = output.replace(/\.[^.]+$/, "") + ".srt";
      const start = firstFrame / fps;
      const words = perf.words.filter((w) => w.end > start && w.start < lastFrame / fps);
      writeFileSync(srtFile, wordsToSrt(words, { offset: -start }));
      log.done(`Sous-titres écrits : ${srtFile}`);
    }
    return { output: encoder ? output : undefined, frames: total, duration: total / fps, hashes, report: opened.report };
  } finally {
    await opened.close();
  }
}

/** Nettoie l'encodeur et le fichier temporaire d'un rendu interrompu. */
function cleanupEncoder(encoder: { process: { kill(signal?: NodeJS.Signals): boolean; exitCode: number | null } } | undefined, tmpOutput: string): void {
  if (encoder && encoder.process.exitCode === null) encoder.process.kill("SIGKILL");
  try {
    if (existsSync(tmpOutput)) unlinkSync(tmpOutput);
  } catch {
    /* ignorer */
  }
}
