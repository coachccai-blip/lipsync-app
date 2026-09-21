import { readFileSync, writeFileSync } from "node:fs";
import { resolveTool, run } from "./tools.js";

export interface WavData {
  sampleRate: number;
  channels: number;
  /** Échantillons mono normalisés -1..1 (canaux moyennés). */
  samples: Float32Array;
  duration: number;
}

/** Lecture d'un WAV PCM 16 bits (ce que produit la normalisation). */
export function readWav(file: string): WavData {
  const buf = readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${file} n'est pas un fichier WAV`);
  }
  let offset = 12;
  let fmt: { channels: number; sampleRate: number; bits: number } | undefined;
  let data: Buffer | undefined;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      const format = buf.readUInt16LE(body);
      if (format !== 1 && format !== 0xfffe) throw new Error(`${file} : format WAV ${format} non géré (PCM attendu)`);
      fmt = { channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === "data") {
      data = buf.subarray(body, Math.min(body + size, buf.length));
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`${file} : blocs fmt/data introuvables`);
  if (fmt.bits !== 16) throw new Error(`${file} : ${fmt.bits} bits non géré (16 bits attendu)`);
  const frames = Math.floor(data.length / (2 * fmt.channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < fmt.channels; c++) acc += data.readInt16LE((i * fmt.channels + c) * 2);
    samples[i] = acc / fmt.channels / 32768;
  }
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, samples, duration: frames / fmt.sampleRate };
}

/** Encapsule du PCM 16 bits mono dans un conteneur WAV. */
export function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function writeWav(file: string, samples: Float32Array, sampleRate: number): void {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  writeFileSync(file, pcmToWav(pcm, sampleRate, 1));
}

export interface NormalizeOptions {
  /** Silence ajouté avant / après, en secondes. */
  padBefore?: number;
  padAfter?: number;
  sampleRate?: number;
}

/**
 * Convertit n'importe quelle entrée en WAV mono 48 kHz 16 bits, volume normalisé
 * (loudnorm), avec un silence de repos avant et après.
 */
export async function normalizeAudio(input: string, output: string, options: NormalizeOptions = {}): Promise<void> {
  const ffmpeg = resolveTool("ffmpeg");
  const sr = options.sampleRate ?? 48000;
  const before = options.padBefore ?? 0;
  const after = options.padAfter ?? 0;
  const filters = [
    "loudnorm=I=-16:TP=-1.5:LRA=11",
    `aformat=sample_fmts=s16:channel_layouts=mono:sample_rates=${sr}`,
    before > 0 ? `adelay=${Math.round(before * 1000)}:all=1` : null,
    after > 0 ? `apad=pad_dur=${after}` : null,
  ].filter(Boolean);
  await run(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-vn", "-af", filters.join(","), "-ar", String(sr), "-ac", "1", "-c:a", "pcm_s16le", output]);
}

/** Convertit un WAV en 16 kHz mono (entrée attendue par whisper.cpp). */
export async function toWhisperWav(input: string, output: string): Promise<void> {
  const ffmpeg = resolveTool("ffmpeg");
  await run(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", output]);
}

/** Durée d'un fichier audio en secondes (via ffprobe, ou en-tête WAV en repli). */
export async function audioDuration(file: string): Promise<number> {
  try {
    const ffprobe = resolveTool("ffprobe");
    const r = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file]);
    const d = parseFloat(r.stdout.trim());
    if (Number.isFinite(d)) return d;
  } catch {
    /* repli sur le WAV */
  }
  return readWav(file).duration;
}
