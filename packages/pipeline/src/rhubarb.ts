import { existsSync, readFileSync } from "node:fs";
import type { RhubarbShape, VisemeCue } from "@avatar/shared";
import { resolveTool, run } from "./tools.js";
import { log } from "./log.js";

interface RhubarbOutput {
  metadata?: { soundFile?: string; duration?: number };
  mouthCues: { start: number; end: number; value: string }[];
}

/** Convertit la sortie JSON de Rhubarb en piste de visèmes triée et contiguë. */
export function parseRhubarb(json: string): VisemeCue[] {
  const data = JSON.parse(json) as RhubarbOutput;
  if (!Array.isArray(data.mouthCues)) throw new Error("Sortie Rhubarb invalide : mouthCues manquant");
  return data.mouthCues
    .map((c) => ({ start: round(c.start), end: round(c.end), shape: c.value as RhubarbShape }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Lance Rhubarb Lip Sync (reconnaisseur phonétique, indépendant de la langue) sur un WAV.
 * Le texte, s'il est fourni, sert de dialogue d'aide à Rhubarb (facultatif).
 */
export async function runRhubarb(wav: string, outputJson: string, options: { text?: string; dialogFile?: string } = {}): Promise<VisemeCue[]> {
  const rhubarb = resolveTool("rhubarb");
  const args = ["-f", "json", "--recognizer", "phonetic", "--extendedShapes", "GHX", "-o", outputJson];
  if (options.dialogFile && existsSync(options.dialogFile)) args.push("-d", options.dialogFile);
  args.push(wav);
  log.info(`rhubarb ${args.join(" ")}`);
  await run(rhubarb, args, {
    onStderr: (s) => {
      const m = /(\d+)%/.exec(s);
      if (m) process.stderr.write(`\r  Rhubarb ${m[1]}%   `);
    },
  });
  process.stderr.write("\r");
  return parseRhubarb(readFileSync(outputJson, "utf8"));
}
