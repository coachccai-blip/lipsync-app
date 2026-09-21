import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { mergeConfig, type AllConfig } from "@avatar/shared";
import { repoRoot } from "./tools.js";

export const CONFIG_FILES = ["scene", "visemes", "emotions", "gestures", "bones"] as const;

/** Charge config/*.json (fusionnés avec les valeurs par défaut). */
export function loadConfig(root = repoRoot()): AllConfig {
  const dir = path.join(root, "config");
  const partial: Partial<Record<(typeof CONFIG_FILES)[number], unknown>> = {};
  for (const name of CONFIG_FILES) {
    const file = path.join(dir, `${name}.json`);
    if (!existsSync(file)) continue;
    try {
      partial[name] = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      throw new Error(`config/${name}.json illisible : ${(e as Error).message}`);
    }
  }
  return mergeConfig(partial);
}

export function configVocab(cfg: AllConfig): { emotions: string[]; gestures: string[] } {
  const emotions = Object.keys(cfg.emotions.emotions);
  const gestures = Array.from(new Set([...Object.keys(cfg.gestures.procedural), ...Object.keys(cfg.gestures.clips)]));
  return { emotions, gestures };
}
