import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export type ToolName = "ffmpeg" | "ffprobe" | "rhubarb" | "whisper";

const ENV_VARS: Record<ToolName, string> = {
  ffmpeg: "FFMPEG_PATH",
  ffprobe: "FFPROBE_PATH",
  rhubarb: "RHUBARB_PATH",
  whisper: "WHISPER_BIN",
};

const DEFAULT_NAMES: Record<ToolName, string[]> = {
  ffmpeg: ["ffmpeg"],
  ffprobe: ["ffprobe"],
  rhubarb: ["rhubarb"],
  whisper: ["whisper-cli", "whisper-cpp", "main"],
};

export class ToolNotFoundError extends Error {
  constructor(tool: ToolName, hint: string) {
    super(`Outil « ${tool} » introuvable. ${hint}`);
    this.name = "ToolNotFoundError";
  }
}

/** Racine du dépôt (où se trouvent config/ et tools/). Surchargeable par AVATAR_ROOT. */
export function repoRoot(): string {
  return process.env.AVATAR_ROOT ?? process.cwd();
}

function findInPath(names: string[]): string | undefined {
  const dirs = (process.env.PATH ?? "").split(path.delimiter);
  const exts = os.platform() === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const name of names) {
    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = path.join(dir, name + ext);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

/**
 * Résout le chemin d'un outil externe : variable d'environnement, puis dossier tools/
 * (rempli par scripts/setup), puis PATH.
 */
export function resolveTool(tool: ToolName): string {
  const fromEnv = process.env[ENV_VARS[tool]];
  if (fromEnv) {
    if (existsSync(fromEnv) || !fromEnv.includes(path.sep)) return fromEnv;
    throw new ToolNotFoundError(tool, `${ENV_VARS[tool]}=${fromEnv} ne pointe pas vers un fichier existant.`);
  }
  const root = repoRoot();
  const exe = os.platform() === "win32" ? ".exe" : "";
  const local: Record<ToolName, string[]> = {
    ffmpeg: [path.join(root, "tools", "ffmpeg", `ffmpeg${exe}`)],
    ffprobe: [path.join(root, "tools", "ffmpeg", `ffprobe${exe}`)],
    rhubarb: [path.join(root, "tools", "rhubarb", `rhubarb${exe}`)],
    whisper: [path.join(root, "tools", "whisper", `whisper-cli${exe}`), path.join(root, "tools", "whisper", `main${exe}`)],
  };
  for (const c of local[tool]) if (existsSync(c)) return c;
  const inPath = findInPath(DEFAULT_NAMES[tool]);
  if (inPath) return inPath;
  const hints: Record<ToolName, string> = {
    ffmpeg: "Installez ffmpeg (apt install ffmpeg, brew install ffmpeg, ou https://ffmpeg.org) ou définissez FFMPEG_PATH.",
    ffprobe: "ffprobe est fourni avec ffmpeg. Installez ffmpeg ou définissez FFPROBE_PATH.",
    rhubarb: "Lancez `npm run setup` pour télécharger Rhubarb Lip Sync, ou définissez RHUBARB_PATH.",
    whisper: "Installez whisper.cpp (binaire whisper-cli) et définissez WHISPER_BIN et WHISPER_MODEL. Voir README.",
  };
  throw new ToolNotFoundError(tool, hints[tool]);
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
  stdoutBuffer: Buffer;
}

export interface RunOptions {
  cwd?: string;
  /** Données envoyées sur stdin. */
  input?: Buffer | string;
  /** Ne pas lever d'erreur en cas de code de sortie non nul. */
  allowFailure?: boolean;
  /** Retourner stdout en binaire uniquement. */
  binary?: boolean;
  onStderr?: (chunk: string) => void;
}

/** Exécute un programme et renvoie sa sortie. Lève une erreur lisible si le code de sortie est non nul. */
export function run(cmd: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const out: Buffer[] = [];
    const err: string[] = [];
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => {
      const s = d.toString();
      err.push(s);
      options.onStderr?.(s);
    });
    child.on("error", (e) => reject(new Error(`Impossible de lancer ${cmd} : ${e.message}`)));
    child.on("close", (code) => {
      const stdoutBuffer = Buffer.concat(out);
      const result: RunResult = { stdout: options.binary ? "" : stdoutBuffer.toString(), stderr: err.join(""), code: code ?? -1, stdoutBuffer };
      if (code !== 0 && !options.allowFailure) {
        const tail = result.stderr.trim().split("\n").slice(-12).join("\n");
        reject(new Error(`${path.basename(cmd)} a échoué (code ${code}) :\n${tail}`));
      } else resolve(result);
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}
