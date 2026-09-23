import type { ExpressionSegment, GestureEvent, Performance, VisemeCue, Word } from "../types.js";
import { Prng } from "../prng.js";

export interface AutoVocab {
  emotions: string[];
  gestures: string[];
}

export interface AutoOptions {
  /** Écart minimal entre deux gestes (s). */
  gestureMinGap?: number;
  gestureMaxGap?: number;
  /** Durée minimale d'un segment d'émotion (s). */
  minSegment?: number;
  /** Salut au début si la parole commence dans les 3 premières secondes. */
  greeting?: boolean;
  seed?: number;
}

export interface Sentence {
  text: string;
  start: number;
  end: number;
  words: Word[];
}

/** Découpe une liste de mots horodatés en phrases (ponctuation forte). */
export function splitSentences(words: Word[]): Sentence[] {
  const sentences: Sentence[] = [];
  let current: Word[] = [];
  for (const w of words) {
    current.push(w);
    if (/[.!?…]["»)]?$/.test(w.w)) {
      sentences.push(build(current));
      current = [];
    }
  }
  if (current.length) sentences.push(build(current));
  return sentences;
  function build(ws: Word[]): Sentence {
    return { text: ws.map((x) => x.w).join(" "), start: ws[0].start, end: ws[ws.length - 1].end, words: ws };
  }
}

/** Phrases déduites des silences (visèmes X d'au moins `pause` s) quand il n'y a pas de mots. */
export function sentencesFromSilences(visemes: VisemeCue[], duration: number, pause = 0.45): Sentence[] {
  const out: Sentence[] = [];
  let start: number | undefined;
  let lastSpeech = 0;
  for (const v of visemes) {
    if (v.shape === "X") {
      if (start !== undefined && v.end - v.start >= pause) {
        out.push({ text: "", start, end: lastSpeech, words: [] });
        start = undefined;
      }
    } else {
      if (start === undefined) start = v.start;
      lastSpeech = v.end;
    }
  }
  if (start !== undefined) out.push({ text: "", start, end: Math.max(lastSpeech, start + 0.1), words: [] });
  return out.filter((s) => s.end - s.start > 0.2 && s.start < duration);
}

function meanEnergy(perf: Performance, start: number, end: number): number {
  const { rate, values } = perf.energy;
  const i0 = Math.max(0, Math.floor(start * rate));
  const i1 = Math.min(values.length, Math.ceil(end * rate));
  if (i1 <= i0) return 0;
  let s = 0;
  for (let i = i0; i < i1; i++) s += values[i];
  return s / (i1 - i0);
}

const pick = <T>(rng: Prng, list: T[]): T => list[Math.floor(rng.next() * list.length)];

/**
 * Pistes d'émotions et de gestes générées sans LLM, à partir de l'audio : phrases (mots ou
 * silences), énergie moyenne, densité d'accents, ponctuation. Déterministe (seed).
 * Couvre toute la durée de la parole ; les balises et l'édition manuelle restent prioritaires.
 */
export function autoTracks(perf: Performance, vocab: AutoVocab, options: AutoOptions = {}): { expressions: ExpressionSegment[]; gestures: GestureEvent[] } {
  const rng = new Prng((options.seed ?? perf.seed) ^ 0x5eed);
  const minGap = options.gestureMinGap ?? 4;
  const maxGap = options.gestureMaxGap ?? 6;
  const minSegment = options.minSegment ?? 1.5;
  const has = (e: string) => vocab.emotions.includes(e);
  const gHas = (g: string) => vocab.gestures.includes(g);

  let sentences = perf.words.length ? splitSentences(perf.words) : sentencesFromSilences(perf.visemes, perf.duration);
  if (!sentences.length) return { expressions: [], gestures: [] };
  // phrases trop courtes : fusionnées avec la suivante
  const merged: Sentence[] = [];
  for (const s of sentences) {
    const last = merged[merged.length - 1];
    if (last && last.end - last.start < minSegment && !/[?!]/.test(last.text)) {
      last.end = s.end;
      last.text = `${last.text} ${s.text}`.trim();
      last.words.push(...s.words);
    } else merged.push({ ...s, words: [...s.words] });
  }
  sentences = merged;

  const energies = sentences.map((s) => meanEnergy(perf, s.start, s.end));
  const sorted = [...energies].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const low = q(0.33);
  const high = q(0.66);
  const accentsIn = (s: Sentence) => perf.accents.filter((a) => a >= s.start && a < s.end).length / Math.max(0.5, s.end - s.start);

  const expressions: ExpressionSegment[] = [];
  let previous = "neutre";
  sentences.forEach((s, i) => {
    const e = energies[i];
    const dens = accentsIn(s);
    let emotion: string;
    if (/\?["»)]?$/.test(s.text)) emotion = pick(rng, ["surpris", "complice", "pensif"].filter(has));
    else if (/!["»)]?$/.test(s.text)) emotion = pick(rng, ["enthousiaste", "enjoué"].filter(has));
    else if (e >= high && dens > 1.2) emotion = pick(rng, ["enthousiaste", "enjoué", "enjoué"].filter(has));
    else if (e >= high) emotion = pick(rng, ["enjoué", "enjoué", "complice"].filter(has));
    else if (e <= low && s.end - s.start > 3) emotion = pick(rng, ["pensif", "sérieux"].filter(has));
    else if (e <= low) emotion = pick(rng, ["sérieux", "neutre", "inquiet"].filter(has));
    else emotion = pick(rng, ["neutre", "enjoué", "sérieux", "complice"].filter(has));
    if (!emotion) emotion = "neutre";
    // éviter de rester trop longtemps sur la même émotion, et les changements à chaque phrase
    if (emotion === previous && rng.chance(0.35)) emotion = pick(rng, ["neutre", "enjoué", "sérieux"].filter(has).filter((x) => x !== previous)) ?? emotion;
    const intensity = Math.round((0.5 + 0.35 * Math.min(1, (e - low) / Math.max(0.05, high - low))) * 100) / 100;
    const last = expressions[expressions.length - 1];
    const start = Math.max(0, s.start - 0.15);
    const end = Math.min(perf.duration, s.end + 0.25);
    if (last && last.emotion === emotion && start - last.end < 0.8) last.end = end;
    else if (emotion !== "neutre") expressions.push({ start: round(start), end: round(end), emotion, intensity, source: "procedural" });
    previous = emotion;
  });

  // gestes : sur les accents, un toutes les 4 à 6 s, choisi selon l'émotion en cours
  const gestures: GestureEvent[] = [];
  const emotionAt = (t: number) => expressions.find((x) => t >= x.start && t < x.end)?.emotion ?? "neutre";
  const byEmotion: Record<string, string[]> = {
    enthousiaste: ["mains_ouvertes", "explication"],
    enjoué: ["explication", "mains_ouvertes", "acquiescement"],
    complice: ["index", "acquiescement"],
    surpris: ["haussement_epaules", "mains_ouvertes"],
    sérieux: ["index", "acquiescement", "explication"],
    inquiet: ["haussement_epaules", "reflexion"],
    pensif: ["reflexion", "haussement_epaules"],
    neutre: ["explication", "acquiescement", "index"],
  };
  const firstSpeech = sentences[0].start;
  let next = firstSpeech + rng.range(1.5, 3);
  if (options.greeting !== false && gHas("salut") && firstSpeech < 3) {
    gestures.push({ at: round(firstSpeech), clip: "salut", source: "procedural" });
    next = firstSpeech + rng.range(minGap, maxGap);
  }
  const lastSpeech = sentences[sentences.length - 1].end;
  const accents = perf.accents.length ? perf.accents : sentences.map((s) => s.start);
  while (next < lastSpeech - 1) {
    // accent le plus proche après `next` (dans une fenêtre d'une seconde), sinon `next`
    const a = accents.find((x) => x >= next && x < next + 1) ?? next;
    const choices = (byEmotion[emotionAt(a)] ?? byEmotion.neutre).filter(gHas);
    if (choices.length) gestures.push({ at: round(a), clip: pick(rng, choices), source: "procedural" });
    next = a + rng.range(minGap, maxGap);
  }
  // fin : léger acquiescement de conclusion
  if (gHas("acquiescement") && lastSpeech - (gestures[gestures.length - 1]?.at ?? 0) > 2.5) {
    gestures.push({ at: round(Math.max(0, lastSpeech - 1.2)), clip: "acquiescement", source: "procedural" });
  }
  return { expressions, gestures };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
