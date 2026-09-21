import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizePerformance, validatePerformance, type Performance } from "@avatar/shared";

export interface ProjectMeta {
  mode: "audio" | "texte";
  input: string;
  createdAt: string;
  updatedAt: string;
}

export const PROJECT_FILES = {
  meta: "project.json",
  performance: "performance.json",
  audio: "audio.wav",
  transcript: "transcript.txt",
  script: "script.txt",
  visemes: "visemes.json",
  words: "words.json",
};

export function ensureProjectDir(dir: string): void {
  mkdirSync(path.join(dir, "cache"), { recursive: true });
  mkdirSync(path.join(dir, "source"), { recursive: true });
}

export function readMeta(dir: string): ProjectMeta | undefined {
  const f = path.join(dir, PROJECT_FILES.meta);
  if (!existsSync(f)) return undefined;
  return JSON.parse(readFileSync(f, "utf8")) as ProjectMeta;
}

export function writeMeta(dir: string, meta: ProjectMeta): void {
  writeFileSync(path.join(dir, PROJECT_FILES.meta), JSON.stringify(meta, null, 2));
}

export function writePerformance(dir: string, perf: Performance): string {
  const f = path.join(dir, PROJECT_FILES.performance);
  writeFileSync(f, JSON.stringify(perf, null, 2));
  return f;
}

/** Lit et valide performance.json d'un dossier projet. */
export function loadPerformance(dir: string, vocab?: { emotions: string[]; gestures: string[] }): Performance {
  const f = path.join(dir, PROJECT_FILES.performance);
  if (!existsSync(f)) throw new Error(`${f} introuvable : lancez d'abord « avatar prepare ».`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(f, "utf8"));
  } catch (e) {
    throw new Error(`${f} n'est pas un JSON valide : ${(e as Error).message}`);
  }
  const perf = validatePerformance(raw, { knownEmotions: vocab?.emotions, knownGestures: vocab?.gestures });
  return normalizePerformance(perf);
}
