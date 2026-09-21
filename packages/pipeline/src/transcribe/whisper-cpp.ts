import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { Word } from "@avatar/shared";
import { toWhisperWav } from "../audio.js";
import { resolveTool, run } from "../tools.js";
import { log } from "../log.js";
import type { Transcriber, Transcription } from "./transcriber.js";

interface WhisperSegment {
  offsets: { from: number; to: number };
  text: string;
}

interface WhisperJson {
  transcription: WhisperSegment[];
  result?: { language?: string };
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Convertit la sortie JSON de whisper.cpp (lancé avec -ml 1 -sow) en mots horodatés. */
export function parseWhisperJson(json: string): Transcription {
  const data = JSON.parse(json) as WhisperJson;
  const words: Word[] = [];
  for (const seg of data.transcription ?? []) {
    const text = seg.text.trim();
    if (!text) continue;
    const parts = text.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p));
    if (parts.length === 0) {
      // ponctuation seule : rattachée au mot précédent
      if (words.length) words[words.length - 1].w += text;
      continue;
    }
    const start = seg.offsets.from / 1000;
    const end = seg.offsets.to / 1000;
    const total = parts.reduce((s, p) => s + p.length, 0);
    let cursor = start;
    for (const p of parts) {
      const share = ((end - start) * p.length) / total;
      words.push({ w: p, start: round(cursor), end: round(cursor + share) });
      cursor += share;
    }
  }
  return { text: words.map((w) => w.w).join(" "), words, language: data.result?.language };
}

/**
 * whisper.cpp : binaire `whisper-cli` (WHISPER_BIN) + modèle ggml (WHISPER_MODEL).
 * L'audio est converti en 16 kHz, et chaque mot devient un segment (-ml 1 -sow).
 */
export class WhisperCppTranscriber implements Transcriber {
  readonly name = "whisper.cpp";

  constructor(private readonly modelPath = process.env.WHISPER_MODEL ?? "") {}

  async transcribe(wav48k: string, options: { language: string; workDir: string }): Promise<Transcription> {
    const bin = resolveTool("whisper");
    if (!this.modelPath || !existsSync(this.modelPath)) {
      throw new Error(
        `Modèle Whisper introuvable (WHISPER_MODEL=${this.modelPath || "non défini"}). ` +
          `Téléchargez un modèle ggml (ex. ggml-small.bin) depuis https://huggingface.co/ggerganov/whisper.cpp et renseignez WHISPER_MODEL.`,
      );
    }
    const wav16 = path.join(options.workDir, "whisper-16k.wav");
    await toWhisperWav(wav48k, wav16);
    const outBase = path.join(options.workDir, "whisper");
    const args = ["-m", this.modelPath, "-l", options.language, "-f", wav16, "-ml", "1", "-sow", "-oj", "-of", outBase, "-np"];
    const extra = process.env.WHISPER_ARGS;
    if (extra) args.push(...extra.split(/\s+/).filter(Boolean));
    log.info(`${path.basename(bin)} ${args.join(" ")}`);
    await run(bin, args);
    const jsonFile = `${outBase}.json`;
    if (!existsSync(jsonFile)) throw new Error(`whisper.cpp n'a pas produit ${jsonFile}`);
    const result = parseWhisperJson(readFileSync(jsonFile, "utf8"));
    try {
      unlinkSync(wav16);
    } catch {
      /* ignorer */
    }
    return result;
  }
}

export type { Word };
