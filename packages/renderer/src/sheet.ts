import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { log, repoRoot, resolveTool, run } from "@avatar/pipeline";
import type { AllConfig, BoneRotations, Performance } from "@avatar/shared";
import { launchChrome } from "./chrome.js";
import { startServer } from "./server.js";

export interface SheetOptions {
  projectDir: string;
  /** Fichier PNG de sortie. */
  out: string;
  /** Rotations d'os à tester, ex. { "bras levé": { rightArm: [0, 0, -100] } }. Remplace la liste des gestes. */
  bones?: Record<string, BoneRotations>;
  /** Inclure les émotions (poses de blendshapes). */
  emotions?: boolean;
  root?: string;
  chromePath?: string;
  /** Taille d'une vignette en pixels. */
  tile?: number;
}

interface Payload {
  performance: Performance;
  config: AllConfig;
}

/**
 * `avatar planche` : planche de contrôle des poses. Rend la pose de repos, chaque geste
 * procédural à mi-parcours (ou des rotations d'os données) et, en option, chaque émotion, puis
 * assemble le tout en une image avec ffmpeg. Sert à régler config/gestures.json à l'œil.
 */
export async function renderPoseSheet(o: SheetOptions): Promise<string> {
  const root = o.root ?? repoRoot();
  const tile = o.tile ?? 400;
  const server = await startServer({ projectDir: o.projectDir, root });
  const base = server.payload() as Payload & { modelUrl?: string };
  if (!base.modelUrl) log.warn("Modèle introuvable : planche avec le personnage de substitution.");
  const browser = await launchChrome({ executablePath: o.chromePath });
  const tmp = mkdtempSync(path.join(os.tmpdir(), "avatar-planche-"));
  try {
    const page = await browser.newPage();
    const { width, height } = base.config.scene.resolution;
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(`${server.url}/index.html?mode=render`, { waitUntil: "load" });
    await page.evaluate(() => window.avatarReady);

    const variants: { name: string; gesture?: { clip: string; t: number }; bones?: BoneRotations; emotion?: string }[] = [{ name: "repos" }];
    if (o.bones) {
      for (const [name, bones] of Object.entries(o.bones)) variants.push({ name, bones });
    } else {
      for (const [name, def] of Object.entries(base.config.gestures.procedural)) {
        // instant du geste le plus éloigné du repos : image clé médiane
        const mid = def.keyframes[Math.floor(def.keyframes.length / 2)]?.t ?? def.duration / 2;
        variants.push({ name, gesture: { clip: name, t: mid } });
      }
    }
    if (o.emotions) for (const name of Object.keys(base.config.emotions.emotions)) if (name !== "neutre") variants.push({ name, emotion: name });

    const files: string[] = [];
    for (const v of variants) {
      const payload: Payload = JSON.parse(JSON.stringify({ performance: base.performance, config: base.config }));
      const p = payload.performance;
      p.visemes = [];
      p.expressions = v.emotion ? [{ start: 0, end: 10, emotion: v.emotion, intensity: 1, source: "test" }] : [];
      p.gestures = v.gesture ? [{ at: 0, clip: v.gesture.clip, source: "test" }] : v.bones ? [{ at: 0, clip: "__test", source: "test" }] : [];
      delete (p as Performance & { test?: boolean }).test;
      const c = payload.config;
      c.scene.life.enabled = false;
      c.gestures.source = "procedural";
      c.gestures.idle.swayAmplitude = 0;
      if (v.bones) {
        c.gestures.fadeMs = 0;
        c.gestures.procedural = { __test: { duration: 10, keyframes: [{ t: 0, bones: v.bones }, { t: 10, bones: v.bones }] } };
      }
      if (v.emotion) c.scene.camera.bottomRatio = Math.max(c.scene.camera.bottomRatio, 0.8);
      const full = { ...base, ...payload };
      await page.evaluate((d) => window.loadProject(d), full as never);
      await page.evaluate((t) => window.renderFrame(t), v.gesture?.t ?? 1);
      const file = path.join(tmp, `${files.length}.png`);
      writeFileSync(file, await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height }, captureBeyondViewport: false }));
      files.push(file);
      log.info(`vignette : ${v.name}`);
    }

    const cols = Math.min(4, Math.ceil(Math.sqrt(variants.length)));
    const rows = Math.ceil(variants.length / cols);
    const label = (s: string) => s.replace(/[\\':;,\[\]]/g, " ");
    const filters: string[] = [];
    variants.forEach((v, i) => {
      filters.push(`[${i}]scale=${tile}:${tile},drawbox=x=0:y=0:w=${tile}:h=40:color=black@0.55:t=fill,drawtext=text='${label(v.name)}':x=8:y=8:fontsize=${Math.round(tile / 14)}:fontcolor=white[v${i}]`);
    });
    const rowLabels: string[] = [];
    for (let r = 0; r < rows; r++) {
      const ids = [];
      for (let ccol = 0; ccol < cols; ccol++) {
        const i = r * cols + ccol;
        if (i < variants.length) ids.push(`[v${i}]`);
        else {
          filters.push(`color=c=black:s=${tile}x${tile}[pad${i}]`);
          ids.push(`[pad${i}]`);
        }
      }
      filters.push(`${ids.join("")}hstack=${cols}[r${r}]`);
      rowLabels.push(`[r${r}]`);
    }
    const graph = filters.join(";") + (rows > 1 ? `;${rowLabels.join("")}vstack=${rows}` : "");
    const inputs = files.flatMap((f) => ["-i", f]);
    const args = ["-y", "-hide_banner", "-loglevel", "error", ...inputs, "-filter_complex", rows > 1 ? graph : graph.replace(/\[r0\]$/, ""), "-frames:v", "1", o.out];
    if (rows === 1) args[args.indexOf("-filter_complex") + 1] = filters.join(";");
    await run(resolveTool("ffmpeg"), args);
    log.done(`Planche écrite : ${o.out} (${variants.length} vignettes)`);
    return o.out;
  } finally {
    await browser.close().catch(() => undefined);
    await server.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}
