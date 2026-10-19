import type { ExpressionSegment, Performance } from "../types.js";
import { Prng } from "../prng.js";
import { sentencesFromSilences, splitSentences } from "./auto.js";

/**
 * Variété des émotions : aucune émotion ne dure plus de `maxSegment` secondes d'affilée.
 * Un segment trop long est découpé à des frontières naturelles (fins de phrases, sinon
 * silences, sinon à intervalles réguliers) et ses morceaux alternent avec des émotions
 * voisines, choisies d'après le texte quand il y en a. Déterministe (seed).
 */

/** Émotions voisines : ce vers quoi on bascule naturellement depuis une émotion tenue trop longtemps. */
export const EMOTION_FAMILY: Record<string, string[]> = {
  enjoué: ["complice", "enthousiaste", "neutre", "pensif"],
  enthousiaste: ["enjoué", "complice", "surpris"],
  complice: ["enjoué", "neutre", "pensif"],
  sérieux: ["pensif", "neutre", "inquiet", "complice"],
  pensif: ["sérieux", "neutre", "complice", "surpris"],
  surpris: ["enjoué", "pensif", "neutre"],
  inquiet: ["sérieux", "pensif", "neutre"],
  neutre: ["enjoué", "sérieux", "pensif"],
};

/** Indices lexicaux : mots qui suggèrent une émotion (texte en minuscules, sans accents obligatoires). */
const CUES: { emotion: string; re: RegExp }[] = [
  { emotion: "enthousiaste", re: /\b(g[ée]nial|super|incroyable|fantastique|formidable|excellent|bravo|magnifique|extraordinaire|top|adore|merci beaucoup)\b/ },
  { emotion: "enjoué", re: /\b(merci|bienvenue|bonjour|plaisir|content|heureu|ravi|sourire|sympa|cool|chouette|ensemble|f[ée]licit)\w*/ },
  { emotion: "inquiet", re: /\b(malheureusement|probl[èe]me|risque|danger|attention|difficile|erreur|peur|inqui|grave|dommage|h[ée]las|crainte)\w*/ },
  { emotion: "sérieux", re: /\b(important|essentiel|crucial|obligatoire|r[èe]gle|jamais|toujours|il faut|vous devez|interdit|imp[ée]ratif|rigueur|strict)\w*/ },
  { emotion: "pensif", re: /\b(peut-?[êe]tre|je pense|je crois|r[ée]fl[ée]chi|imagin|suppos|sans doute|probablement|question|hypoth|on pourrait|voyons)\w*/ },
  { emotion: "surpris", re: /\b(surpr|[ée]tonn|incroyable|vraiment|quoi|figurez-vous|devinez|saviez-vous|inattendu|soudain)\w*/ },
  { emotion: "complice", re: /\b(entre nous|vous savez|avouez|n'est-ce pas|hein|petit secret|franchement|on le sait|bien s[ûu]r)\b/ },
];

/** Émotion suggérée par le texte d'un passage, parmi le vocabulaire, ou undefined. */
export function lexicalEmotion(text: string, vocab: string[]): string | undefined {
  const t = text.toLowerCase();
  if (/\?["»)]?\s*$/.test(t)) {
    const q = ["surpris", "pensif", "complice"].find((e) => vocab.includes(e));
    if (q) return q;
  }
  for (const c of CUES) if (vocab.includes(c.emotion) && c.re.test(t)) return c.emotion;
  if (/!["»)]?\s*$/.test(t)) return ["enthousiaste", "enjoué"].find((e) => vocab.includes(e));
  return undefined;
}

export interface VarietyOptions {
  /** Durée maximale d'une même émotion d'affilée (s). */
  maxSegment?: number;
  /** Durée minimale d'un morceau après découpe (s). */
  minPiece?: number;
  seed?: number;
}

interface Boundary {
  t: number;
  /** Texte du passage qui se termine à t (vide si inconnu). */
  text: string;
}

/** Frontières naturelles du discours : fins de phrases, sinon silences, avec le texte du passage. */
export function naturalBoundaries(perf: Pick<Performance, "words" | "visemes" | "duration">): Boundary[] {
  if (perf.words.length) {
    const sentences = splitSentences(perf.words);
    return sentences.map((s) => ({ t: s.end, text: s.text }));
  }
  return sentencesFromSilences(perf.visemes, perf.duration).map((s) => ({ t: s.end, text: "" }));
}

/**
 * Découpe les segments trop longs et varie les émotions. Les segments `balise` et `manuel`
 * ne sont jamais modifiés. Renvoie une liste triée, sans chevauchement.
 */
export function varyEmotions(expressions: ExpressionSegment[], perf: Pick<Performance, "words" | "visemes" | "duration" | "seed">, vocab: string[], options: VarietyOptions = {}): ExpressionSegment[] {
  const max = options.maxSegment ?? 10;
  const minPiece = options.minPiece ?? 2;
  const rng = new Prng((options.seed ?? perf.seed) ^ 0x7a12e);
  const boundaries = naturalBoundaries(perf);
  const has = (e: string) => vocab.includes(e);
  const sorted = [...expressions].sort((a, b) => a.start - b.start);
  const out: ExpressionSegment[] = [];
  let previous: string | undefined;
  let previousEnd = -Infinity;
  let runStart = -Infinity; // début de la série en cours d'une même émotion

  const pickOther = (current: string, text: string, avoid: string[]): string => {
    const lex = lexicalEmotion(text, vocab);
    if (lex && lex !== current && !avoid.includes(lex)) return lex;
    const family = (EMOTION_FAMILY[current] ?? EMOTION_FAMILY.neutre).filter((e) => has(e) && e !== current && !avoid.includes(e));
    if (family.length) return family[Math.floor(rng.next() * family.length)];
    const any = vocab.filter((e) => e !== current && !avoid.includes(e));
    return any.length ? any[Math.floor(rng.next() * any.length)] : current;
  };

  for (const seg of sorted) {
    if (seg.source === "balise" || seg.source === "manuel") {
      out.push(seg);
      previous = seg.emotion;
      previousEnd = seg.end;
      runStart = seg.start;
      continue;
    }
    // points de coupe possibles dans le segment
    const cuts = boundaries.filter((b) => b.t > seg.start + minPiece && b.t < seg.end - minPiece);
    const pieces: { start: number; end: number; text: string }[] = [];
    let start = seg.start;
    let emotion = seg.emotion;
    // la série courante continue-t-elle la même émotion ?
    const continuing = previous === seg.emotion && seg.start - previousEnd < 0.8;
    let runBegin = continuing ? runStart : seg.start;
    const textBetween = (a: number, b: number) => boundaries.filter((x) => x.t > a && x.t <= b + 0.01).map((x) => x.text).join(" ");
    while (seg.end - start > 0.05) {
      const limit = runBegin + max;
      if (seg.end <= limit + 0.05) {
        pieces.push({ start, end: seg.end, text: textBetween(start, seg.end) });
        break;
      }
      // coupe la plus tardive avant la limite, sinon la limite elle-même
      const candidates = cuts.filter((c) => c.t > start + minPiece && c.t <= limit);
      const cutAt = candidates.length ? candidates[candidates.length - 1].t : Math.max(start + minPiece, limit);
      pieces.push({ start, end: Math.min(cutAt, seg.end), text: textBetween(start, cutAt) });
      start = Math.min(cutAt, seg.end);
      runBegin = start;
    }
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (i > 0 || continuing) {
        const avoid = i > 0 ? [pieces[i - 1] ? out[out.length - 1]?.emotion ?? "" : ""] : [];
        emotion = pickOther(out[out.length - 1]?.emotion ?? seg.emotion, p.text, avoid);
      }
      const last = out[out.length - 1];
      if (last && last.emotion === emotion && p.start - last.end < 0.8 && last.source !== "balise" && last.source !== "manuel") {
        last.end = Math.max(last.end, p.end);
      } else out.push({ ...seg, start: round(p.start), end: round(p.end), emotion });
    }
    const lastOut = out[out.length - 1];
    previous = lastOut.emotion;
    previousEnd = lastOut.end;
    // début de la série de l'émotion courante
    let rs = lastOut.start;
    for (let i = out.length - 2; i >= 0 && out[i].emotion === previous && out[i + 1].start - out[i].end < 0.8; i--) rs = out[i].start;
    runStart = rs;
  }
  return out.filter((s) => s.end - s.start > 0.05);
}

const round = (v: number) => Math.round(v * 1000) / 1000;
