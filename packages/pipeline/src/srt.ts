import type { Word } from "@avatar/shared";

export interface SrtOptions {
  /** Longueur maximale d'une ligne de sous-titre (caractères). */
  maxChars?: number;
  /** Durée maximale d'un sous-titre (s). */
  maxDuration?: number;
  /** Décalage appliqué à tous les temps (s), ex. pour retirer le silence de repos. */
  offset?: number;
}

function stamp(t: number): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

/** Regroupe les mots horodatés en sous-titres SRT (coupure sur la ponctuation, la longueur et la durée). */
export function wordsToSrt(words: Word[], options: SrtOptions = {}): string {
  const maxChars = options.maxChars ?? 42;
  const maxDuration = options.maxDuration ?? 4;
  const offset = options.offset ?? 0;
  const cues: { start: number; end: number; text: string }[] = [];
  let current: Word[] = [];
  const flush = () => {
    if (!current.length) return;
    cues.push({ start: current[0].start, end: current[current.length - 1].end, text: current.map((w) => w.w).join(" ") });
    current = [];
  };
  for (const w of words) {
    const text = [...current, w].map((x) => x.w).join(" ");
    const tooLong = current.length > 0 && (text.length > maxChars || w.end - current[0].start > maxDuration);
    if (tooLong) flush();
    current.push(w);
    if (/[.!?…]["»)]?$/.test(w.w)) flush();
  }
  flush();
  // éviter les chevauchements et les durées nulles
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].end - cues[i].start < 0.5) cues[i].end = cues[i].start + 0.5;
    if (i + 1 < cues.length && cues[i].end > cues[i + 1].start) cues[i].end = cues[i + 1].start;
  }
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start + offset)} --> ${stamp(c.end + offset)}\n${c.text}\n`).join("\n") + (cues.length ? "\n" : "");
}
