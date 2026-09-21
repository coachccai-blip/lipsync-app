#!/usr/bin/env node
/**
 * scripts/smoke : vrai appel de bout en bout (Azure TTS, Whisper, Rhubarb, LLM, rendu) sur un
 * court script, avec les clés de .env. Usage : npm run smoke [-- --audio voix.mp3]
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "packages", "cli", "dist", "index.js");
if (!existsSync(cli)) {
  console.error("Construisez d'abord : npm run build");
  process.exit(1);
}
const out = path.join(root, "projets", "smoke");
mkdirSync(out, { recursive: true });
const audioIdx = process.argv.indexOf("--audio");
let prepareArgs;
if (audioIdx > 0) prepareArgs = ["--audio", process.argv[audioIdx + 1]];
else {
  const script = path.join(out, "script.txt");
  writeFileSync(script, "[enjoué] Bonjour à tous ! [geste:salut] Ceci est un test rapide d'Avatar Studio.\n\n[sérieux] Si vous voyez cette phrase, la chaîne complète fonctionne. [geste:index]\n");
  prepareArgs = ["--texte", script];
}
const run = (args) => {
  console.log(`\n$ avatar ${args.join(" ")}`);
  const r = spawnSync("node", [cli, ...args], { stdio: "inherit", cwd: root });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(["prepare", ...prepareArgs, "--out", out]);
run(["render", out, "--format", "mp4"]);
console.log(`\nOK : ${path.join(out, "sortie.mp4")}`);
