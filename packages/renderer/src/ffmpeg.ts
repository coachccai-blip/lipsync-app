import { spawn, type ChildProcess } from "node:child_process";
import { resolveTool } from "@avatar/pipeline";

export type OutputFormat = "mp4" | "prores4444" | "webm-alpha";

export const FORMAT_EXT: Record<OutputFormat, string> = { mp4: ".mp4", prores4444: ".mov", "webm-alpha": ".webm" };
export const FORMAT_TRANSPARENT: Record<OutputFormat, boolean> = { mp4: false, prores4444: true, "webm-alpha": true };

export interface EncodeOptions {
  format: OutputFormat;
  fps: number;
  audio: string;
  output: string;
  /** Extrait audio [start, end] en secondes (aligné sur --debut / --fin). */
  start: number;
  end: number;
}

/** Arguments ffmpeg : images PNG sur stdin + audio -> fichier final. */
export function encodeArgs(o: EncodeOptions): string[] {
  const video: Record<OutputFormat, string[]> = {
    mp4: ["-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k"],
    prores4444: ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-c:a", "pcm_s16le"],
    "webm-alpha": ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-crf", "20", "-b:v", "0", "-c:a", "libopus"],
  };
  return [
    "-y", "-hide_banner", "-loglevel", "error", "-stats",
    "-f", "image2pipe", "-framerate", String(o.fps), "-i", "pipe:0",
    "-i", o.audio,
    "-af", `atrim=start=${o.start}:end=${o.end},asetpts=PTS-STARTPTS`,
    "-map", "0:v:0", "-map", "1:a:0",
    ...video[o.format],
    "-r", String(o.fps),
    "-shortest",
    o.output,
  ];
}

export interface Encoder {
  write(png: Buffer): Promise<void>;
  finish(): Promise<void>;
  process: ChildProcess;
}

/** Démarre ffmpeg et renvoie un écrivain d'images avec gestion de la contre-pression. */
export function startEncoder(o: EncodeOptions): Encoder {
  const ffmpeg = resolveTool("ffmpeg");
  const child = spawn(ffmpeg, encodeArgs(o), { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => {
    stderr += d.toString();
    if (stderr.length > 20000) stderr = stderr.slice(-10000);
  });
  const exit = new Promise<void>((resolve, reject) => {
    child.on("error", (e) => reject(new Error(`ffmpeg : ${e.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg a échoué (code ${code}) :\n${stderr.trim().split("\n").slice(-10).join("\n")}`));
    });
  });
  let failed: Error | undefined;
  exit.catch((e) => (failed = e));
  return {
    process: child,
    write: (png) =>
      new Promise<void>((resolve, reject) => {
        if (failed) return reject(failed);
        if (!child.stdin.writable) return reject(new Error("ffmpeg a fermé son entrée"));
        const ok = child.stdin.write(png, (err) => (err ? reject(err) : undefined));
        if (ok) resolve();
        else child.stdin.once("drain", () => resolve());
      }),
    finish: async () => {
      child.stdin.end();
      await exit;
    },
  };
}
