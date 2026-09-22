#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { config as loadEnv } from "dotenv";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PerformanceValidationError, makeTestPerformance } from "@avatar/shared";
import { ToolNotFoundError, checkEnvironment, configVocab, loadConfig, loadPerformance, log, prepare, repoRoot, resolveTool, run, writePerformance } from "@avatar/pipeline";
import { FORMAT_EXT, renderPoseSheet, renderProject, startServer, type OutputFormat } from "@avatar/renderer";

loadEnv({ path: path.join(repoRoot(), ".env") });

const num = (v: string): number => {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) throw new InvalidArgumentError("nombre attendu");
  return n;
};

const program = new Command();
program.name("avatar").description("Avatar Studio : voix ou texte → vidéo d'un personnage 3D en lip sync").version("0.1.0");

program
  .command("prepare")
  .description("Analyse l'entrée et produit le dossier projet (audio.wav, transcript.txt, performance.json)")
  .option("--audio <fichier>", "mode A : enregistrement de voix (mp3, wav, m4a…)")
  .option("--texte <fichier>", "mode B : script texte (balises [émotion] et [geste:nom])")
  .requiredOption("--out <dossier>", "dossier projet")
  .option("--sans-llm", "pas d'annotation LLM : expressions et gestes procéduraux + balises")
  .option("--seed <n>", "graine de l'aléatoire (défaut : 12345 ou celle du projet)", num)
  .option("--fps <n>", "cadence (défaut : config/scene.json)", num)
  .option("--force", "ignore le cache et recalcule toutes les étapes")
  .action(async (opts) => {
    const r = await prepare({ audio: opts.audio, texte: opts.texte, out: opts.out, sansLlm: opts.sansLlm, seed: opts.seed, fps: opts.fps, force: opts.force });
    if (r.warnings.length) log.warn(`${r.warnings.length} avertissement(s) ci-dessus.`);
    log.info(`Suite : avatar preview ${opts.out}   puis   avatar render ${opts.out} --format mp4`);
  });

async function launchStudio(opts: { port: number; transparent?: boolean; projet?: string; noOpen?: boolean }): Promise<void> {
  const server = await startServer({ projectDir: opts.projet, port: opts.port, watch: true, background: opts.transparent ? "transparent" : "green" });
  const url = `${server.url}/index.html?mode=studio${opts.projet ? `&project=${encodeURIComponent(path.basename(path.resolve(opts.projet)))}` : ""}`;
  log.done(`Studio : ${url}`);
  log.info("Préparation, rendu, réglages et pistes se font dans la page. Ctrl+C pour arrêter.");
  if (!opts.noOpen) await openBrowser(url);
  await new Promise(() => undefined);
}

program
  .command("studio")
  .description("Ouvre le studio (projets, préparation, pistes, réglages, rendu) dans le navigateur")
  .option("--port <n>", "port HTTP (défaut : 4242)", num, 4242)
  .option("--transparent", "fond transparent au lieu du fond vert")
  .option("--no-open", "n'ouvre pas le navigateur")
  .action(async (opts) => launchStudio({ port: opts.port, transparent: opts.transparent, noOpen: opts.open === false }));

program
  .command("preview")
  .description("Ouvre le studio sur un projet donné (prévisualisation temps réel, rechargement à chaud)")
  .argument("<projet>", "dossier projet")
  .option("--port <n>", "port HTTP (défaut : 4242)", num, 4242)
  .option("--transparent", "fond transparent au lieu du fond vert")
  .option("--no-open", "n'ouvre pas le navigateur")
  .action(async (projet: string, opts) => {
    loadPerformance(projet, configVocab(loadConfig()));
    await launchStudio({ port: opts.port, transparent: opts.transparent, projet, noOpen: opts.open === false });
  });

program
  .command("render")
  .description("Rendu hors ligne, image par image, déterministe")
  .argument("<projet>", "dossier projet")
  .option("--format <f>", "mp4 (fond vert), prores4444 (transparence), webm-alpha (transparence)", "mp4")
  .option("--out <fichier>", "fichier de sortie (défaut : <projet>/sortie.<ext>)")
  .option("--debut <s>", "début de l'extrait en secondes", num)
  .option("--fin <s>", "fin de l'extrait en secondes", num)
  .option("--frames <dossier>", "écrit aussi les PNG dans ce dossier")
  .option("--software", "force le rendu WebGL logiciel (SwiftShader)")
  .option("--brouillon", "rendu rapide en demi-résolution (sortie-brouillon.*)")
  .option("--srt", "écrit aussi les sous-titres SRT à côté de la vidéo")
  .action(async (projet: string, opts) => {
    const format = opts.format as OutputFormat;
    if (!["mp4", "prores4444", "webm-alpha"].includes(format)) throw new Error(`Format inconnu : ${format} (mp4, prores4444, webm-alpha)`);
    const out = opts.out ?? (opts.brouillon ? path.join(projet, `sortie-brouillon${FORMAT_EXT[format]}`) : undefined);
    await renderProject({ projectDir: projet, format, out, debut: opts.debut, fin: opts.fin, framesDir: opts.frames, software: opts.software, scale: opts.brouillon ? 2 : 1, srt: opts.srt });
  });

program
  .command("test-project")
  .description("Crée un projet de test (son de test + animation de test : rotation de tête et jawOpen sinusoïdal)")
  .argument("<projet>", "dossier projet à créer")
  .option("--duree <s>", "durée en secondes", num, 4)
  .option("--visemes", "séquence de visèmes factice au lieu de l'animation de test")
  .action(async (projet: string, opts) => {
    const cfg = loadConfig();
    mkdirSync(projet, { recursive: true });
    const wav = path.join(projet, "audio.wav");
    const ffmpeg = resolveTool("ffmpeg");
    // bip toutes les secondes : permet de vérifier la synchronisation audio/vidéo à l'oreille
    await run(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=880:duration=${opts.duree}:sample_rate=48000`, "-af", "volume='if(lt(mod(t,1),0.1),1,0.05)':eval=frame", "-ac", "1", "-c:a", "pcm_s16le", wav]);
    const perf = makeTestPerformance(opts.duree, cfg.scene.fps, 12345, Boolean(opts.visemes));
    writePerformance(projet, perf);
    log.done(`Projet de test créé : ${projet}`);
    log.info(`Suite : avatar render ${projet} --format mp4`);
  });

program
  .command("planche")
  .description("Planche de contrôle : pose de repos, chaque geste procédural et (option) chaque émotion en une image PNG")
  .argument("<projet>", "dossier projet (sert pour l'audio et la config)")
  .option("--out <fichier>", "image de sortie (défaut : <projet>/planche.png)")
  .option("--emotions", "ajoute une vignette par émotion")
  .option("--os <liste>", "rotations d'os à tester au lieu des gestes, ex. \"rightArm=0,0,-100;rightForeArm=-90,0,0\" (plusieurs vignettes séparées par |)")
  .option("--tile <px>", "taille d'une vignette", num, 400)
  .action(async (projet: string, opts) => {
    let bones: Record<string, Record<string, [number, number, number]>> | undefined;
    if (opts.os) {
      bones = {};
      for (const group of String(opts.os).split("|")) {
        const rot: Record<string, [number, number, number]> = {};
        for (const item of group.split(";")) {
          const [name, values] = item.split("=");
          if (!name || !values) continue;
          const [x, y, z] = values.split(",").map(Number);
          rot[name.trim()] = [x || 0, y || 0, z || 0];
        }
        bones[group.trim()] = rot;
      }
    }
    await renderPoseSheet({ projectDir: projet, out: opts.out ?? path.join(projet, "planche.png"), bones, emotions: opts.emotions, tile: opts.tile });
  });

program
  .command("check")
  .description("Vérifie les outils externes, les variables d'environnement, le modèle et le player")
  .action(async () => {
    const { findChrome } = await import("@avatar/renderer");
    const report = checkEnvironment({ findChrome });
    for (const it of report.items) (it.ok ? log.done : log.warn)(`${it.label} : ${it.detail}${it.ok ? "" : ` → ${it.impact}`}`);
    if (report.models.length) log.info(`modèles disponibles : ${report.models.join(", ")}`);
  });

async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  const cmd = platform === "darwin" ? ["open", url] : platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  try {
    await run(cmd[0], cmd.slice(1), { allowFailure: true });
  } catch {
    /* pas de navigateur : l'URL est affichée */
  }
}

program.parseAsync(process.argv).catch((e: unknown) => {
  if (e instanceof PerformanceValidationError) log.error(e.message);
  else if (e instanceof ToolNotFoundError) log.error(e.message);
  else log.error((e as Error).stack ?? String(e));
  process.exit(1);
});

