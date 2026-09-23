import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import type { AllConfig } from "@avatar/shared";
import { bubbleGeometry } from "../bubble.js";

export interface ExportOptions {
  cfg: AllConfig;
  fps: number;
  duration: number;
  renderFrame(t: number): Promise<void>;
  captureCanvas(): HTMLCanvasElement | undefined;
  audio?: { mono: Float32Array; sampleRate: number };
  onProgress?(done: number, total: number): void;
  /** Avertissements non bloquants (ex. audio encodé en Opus faute d'AAC). */
  onWarning?(message: string): void;
  signal?: AbortSignal;
}

export function browserExportSupported(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

/**
 * Export MP4 dans le navigateur (WebCodecs H.264 + AAC, muxage mp4-muxer) : même
 * boucle image par image que le rendu hors ligne, sans serveur ni ffmpeg. La page
 * (fond, bulle, anneau) est recomposée dans un canvas à la résolution de sortie.
 */
export async function exportMp4(o: ExportOptions): Promise<Blob> {
  if (!browserExportSupported()) throw new Error("Ce navigateur ne prend pas en charge WebCodecs (utilisez Chrome, Edge ou un Firefox récent).");
  const { width, height } = o.cfg.scene.resolution;
  const fps = o.fps;
  const total = Math.ceil(o.duration * fps);
  const video = await pickVideoCodec(width, height, fps);
  if (video.mux !== "avc") o.onWarning?.(`H.264 indisponible dans ce navigateur : vidéo encodée en ${video.mux === "vp9" ? "VP9" : video.mux === "av1" ? "AV1" : "HEVC"} (MP4 lisible dans Chrome, VLC, ffmpeg).`);
  const target = new ArrayBufferTarget();
  const audioRate = o.audio ? (o.audio.sampleRate === 44100 || o.audio.sampleRate === 48000 ? o.audio.sampleRate : 48000) : 48000;
  const audioCodec = o.audio ? await pickAudioCodec(audioRate) : undefined;
  if (o.audio && !audioCodec) o.onWarning?.("Aucun encodeur audio disponible dans ce navigateur : vidéo exportée sans son.");
  if (audioCodec?.mux === "opus") o.onWarning?.("AAC indisponible dans ce navigateur : piste audio encodée en Opus (lisible dans Chrome, VLC, ffmpeg).");
  const muxer = new Muxer({
    target,
    video: { codec: video.mux, width, height, frameRate: fps },
    audio: audioCodec ? { codec: audioCodec.mux, numberOfChannels: 1, sampleRate: audioRate } : undefined,
    fastStart: "in-memory",
  });
  let encodeError: Error | undefined;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encodeError = e as Error),
  });
  videoEncoder.configure({ ...video.config, bitrate: Math.round(width * height * fps * 0.12), latencyMode: "quality" });

  // audio
  let audioEncoder: AudioEncoder | undefined;
  if (o.audio && audioCodec) {
    let samples = o.audio.mono;
    if (o.audio.sampleRate !== audioRate) samples = resampleLinear(samples, o.audio.sampleRate, audioRate);
    const maxFrames = Math.min(samples.length, Math.ceil(o.duration * audioRate));
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => (encodeError = e as Error),
    });
    audioEncoder.configure({ codec: audioCodec.codec, sampleRate: audioRate, numberOfChannels: 1, bitrate: 128000 });
    const block = 4096;
    for (let i = 0; i < maxFrames; i += block) {
      const n = Math.min(block, maxFrames - i);
      const data = new AudioData({ format: "f32-planar", sampleRate: audioRate, numberOfFrames: n, numberOfChannels: 1, timestamp: Math.round((i / audioRate) * 1e6), data: samples.slice(i, i + n) });
      audioEncoder.encode(data);
      data.close();
      if (audioEncoder.encodeQueueSize > 8) await tick();
    }
  }

  // composition de la page
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d")!;
  const { d, cx, cy } = bubbleGeometry(o.cfg.scene);
  const ring = o.cfg.scene.bubble.ring;
  const bubbleFill = parseCssBackground(o.cfg.scene.bubble.background, ctx, cx - d / 2, cy - d / 2, d, d);
  const frameUs = 1e6 / fps;
  for (let n = 0; n < total; n++) {
    if (o.signal?.aborted) {
      videoEncoder.close();
      audioEncoder?.close();
      throw new Error("Export annulé");
    }
    if (encodeError) throw encodeError;
    await o.renderFrame(n / fps);
    const src = o.captureCanvas();
    ctx.fillStyle = o.cfg.scene.background.color;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = bubbleFill;
    ctx.fillRect(cx - d / 2, cy - d / 2, d, d);
    if (src) ctx.drawImage(src, cx - d / 2, cy - d / 2, d, d);
    ctx.restore();
    if (ring.enabled && ring.width > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, d / 2 - ring.width / 2, 0, Math.PI * 2);
      ctx.lineWidth = ring.width;
      ctx.strokeStyle = ring.color;
      ctx.stroke();
    }
    const frame = new VideoFrame(out, { timestamp: Math.round(n * frameUs), duration: Math.round(frameUs) });
    videoEncoder.encode(frame, { keyFrame: n % (fps * 2) === 0 });
    frame.close();
    while (videoEncoder.encodeQueueSize > 6) await tick();
    o.onProgress?.(n + 1, total);
  }
  await videoEncoder.flush();
  await audioEncoder?.flush();
  if (encodeError) throw encodeError;
  videoEncoder.close();
  audioEncoder?.close();
  muxer.finalize();
  return new Blob([target.buffer], { type: "video/mp4" });
}

type MuxVideo = "avc" | "hevc" | "vp9" | "av1";

/** H.264 (High puis Main/Baseline) en priorité, sinon HEVC, VP9 ou AV1 selon ce que le navigateur sait encoder. */
async function pickVideoCodec(width: number, height: number, framerate: number): Promise<{ mux: MuxVideo; config: VideoEncoderConfig }> {
  const candidates: { mux: MuxVideo; codec: string; extra?: Partial<VideoEncoderConfig> }[] = [
    { mux: "avc", codec: "avc1.640033", extra: { avc: { format: "avc" } } },
    { mux: "avc", codec: "avc1.64002A", extra: { avc: { format: "avc" } } },
    { mux: "avc", codec: "avc1.640028", extra: { avc: { format: "avc" } } },
    { mux: "avc", codec: "avc1.4D0028", extra: { avc: { format: "avc" } } },
    { mux: "avc", codec: "avc1.42E01E", extra: { avc: { format: "avc" } } },
    { mux: "hevc", codec: "hev1.1.6.L120.B0", extra: { hevc: { format: "hevc" } } as Partial<VideoEncoderConfig> },
    { mux: "vp9", codec: "vp09.00.40.08" },
    { mux: "vp9", codec: "vp09.00.10.08" },
    { mux: "av1", codec: "av01.0.08M.08" },
  ];
  for (const c of candidates) {
    const config: VideoEncoderConfig = { codec: c.codec, width, height, framerate, ...c.extra };
    try {
      const r = await VideoEncoder.isConfigSupported(config);
      if (r.supported) return { mux: c.mux, config };
    } catch {
      /* suivant */
    }
  }
  throw new Error(`Aucun encodeur vidéo pris en charge pour ${width}×${height}`);
}

async function pickAudioCodec(sampleRate: number): Promise<{ codec: string; mux: "aac" | "opus" } | undefined> {
  const candidates: { codec: string; mux: "aac" | "opus" }[] = [
    { codec: "mp4a.40.2", mux: "aac" },
    { codec: "opus", mux: "opus" },
  ];
  for (const c of candidates) {
    try {
      const r = await AudioEncoder.isConfigSupported({ codec: c.codec, sampleRate, numberOfChannels: 1, bitrate: 128000 });
      if (r.supported) return c;
    } catch {
      /* suivant */
    }
  }
  return undefined;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function resampleLinear(src: Float32Array, from: number, to: number): Float32Array {
  const n = Math.round((src.length * to) / from);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = (i * from) / to;
    const j = Math.floor(pos);
    const a = src[Math.min(j, src.length - 1)];
    const b = src[Math.min(j + 1, src.length - 1)];
    out[i] = a + (b - a) * (pos - j);
  }
  return out;
}

/** Découpe une liste CSS sur les virgules de premier niveau (parenthèses respectées). */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Convertit un fond CSS (couleur, linear-gradient, radial-gradient simple) en style de canvas,
 * pour le rectangle (x, y, w, h). Ce qui n'est pas reconnu retombe sur la première couleur.
 */
export function parseCssBackground(css: string, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): string | CanvasGradient {
  const src = css.trim();
  const m = /^(radial|linear)-gradient\((.*)\)$/s.exec(src);
  if (!m) return src || "#ffffff";
  const parts = splitTop(m[2]);
  let stops = parts;
  let gradient: CanvasGradient;
  if (m[1] === "radial") {
    let cxp = 0.5;
    let cyp = 0.5;
    if (/^(circle|ellipse|farthest|closest|at\s)/.test(parts[0]) || /\bat\b/.test(parts[0])) {
      const at = /at\s+([\d.]+)%\s+([\d.]+)%/.exec(parts[0]);
      if (at) {
        cxp = Number(at[1]) / 100;
        cyp = Number(at[2]) / 100;
      }
      stops = parts.slice(1);
    }
    const cx = x + cxp * w;
    const cy = y + cyp * h;
    const r = Math.max(Math.hypot(cx - x, cy - y), Math.hypot(x + w - cx, cy - y), Math.hypot(cx - x, y + h - cy), Math.hypot(x + w - cx, y + h - cy));
    gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  } else {
    let angle = 180;
    const first = parts[0];
    const deg = /^(-?[\d.]+)deg$/.exec(first);
    const to = /^to\s+(.+)$/.exec(first);
    if (deg) {
      angle = Number(deg[1]);
      stops = parts.slice(1);
    } else if (to) {
      const dir = to[1].trim();
      angle = { top: 0, right: 90, bottom: 180, left: 270, "top right": 45, "right top": 45, "bottom right": 135, "right bottom": 135, "bottom left": 225, "left bottom": 225, "top left": 315, "left top": 315 }[dir] ?? 180;
      stops = parts.slice(1);
    }
    const a = ((angle - 90) * Math.PI) / 180;
    const len = Math.abs(w * Math.sin((angle * Math.PI) / 180)) + Math.abs(h * Math.cos((angle * Math.PI) / 180));
    const cx = x + w / 2;
    const cy = y + h / 2;
    gradient = ctx.createLinearGradient(cx - (Math.cos(a) * len) / 2, cy - (Math.sin(a) * len) / 2, cx + (Math.cos(a) * len) / 2, cy + (Math.sin(a) * len) / 2);
  }
  const parsed = stops.map((s, i) => {
    const pm = /^(.*?)\s+([\d.]+)%$/.exec(s);
    return { color: pm ? pm[1].trim() : s, pos: pm ? Number(pm[2]) / 100 : i / Math.max(1, stops.length - 1) };
  });
  try {
    for (const st of parsed) gradient.addColorStop(Math.min(1, Math.max(0, st.pos)), st.color);
  } catch {
    return parsed[0]?.color ?? "#ffffff";
  }
  return gradient;
}
