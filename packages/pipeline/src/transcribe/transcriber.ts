import type { Word } from "@avatar/shared";

export interface Transcription {
  text: string;
  words: Word[];
  language?: string;
}

/** Transcription avec horodatage au mot. Implémentation par défaut : whisper.cpp en local. */
export interface Transcriber {
  readonly name: string;
  transcribe(wav48k: string, options: { language: string; workDir: string }): Promise<Transcription>;
}
