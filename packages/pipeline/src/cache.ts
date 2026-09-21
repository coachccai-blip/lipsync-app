import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { log } from "./log.js";

/** Hash SHA-256 du contenu d'un fichier (ou "absent"). */
export function hashFile(file: string): string {
  if (!existsSync(file)) return "absent";
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function hashString(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Hash combiné de plusieurs éléments (fichiers ou chaînes). */
export function hashInputs(parts: Array<{ file: string } | { text: string }>): string {
  const h = createHash("sha256");
  for (const p of parts) {
    if ("file" in p) h.update(`file:${path.basename(p.file)}:${hashFile(p.file)}\n`);
    else h.update(`text:${p.text}\n`);
  }
  return h.digest("hex");
}

interface CacheEntry<T> {
  hash: string;
  result: T;
  at: string;
}

/**
 * Exécute une étape avec mise en cache dans `<projet>/cache/<name>.json`.
 * L'étape est recalculée uniquement si le hash de ses entrées a changé ou si
 * l'un des fichiers qu'elle produit a disparu.
 */
export async function cachedStep<T>(
  projectDir: string,
  name: string,
  inputHash: string,
  outputs: string[],
  fn: () => Promise<T>,
  options: { force?: boolean } = {},
): Promise<{ result: T; fromCache: boolean }> {
  const cacheDir = path.join(projectDir, "cache");
  mkdirSync(cacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, `${name}.json`);
  if (!options.force && existsSync(cacheFile)) {
    try {
      const entry = JSON.parse(readFileSync(cacheFile, "utf8")) as CacheEntry<T>;
      const outputsOk = outputs.every((o) => existsSync(o) && statSync(o).size > 0);
      if (entry.hash === inputHash && outputsOk) {
        log.info(`${name} : entrées inchangées, résultat en cache`);
        return { result: entry.result, fromCache: true };
      }
    } catch {
      /* cache illisible : on recalcule */
    }
  }
  const result = await fn();
  const entry: CacheEntry<T> = { hash: inputHash, result, at: new Date().toISOString() };
  writeFileSync(cacheFile, JSON.stringify(entry, null, 2));
  return { result, fromCache: false };
}
