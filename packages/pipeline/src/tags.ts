/**
 * Balises de jeu dans le script (mode B) :
 *   [enjoué] Bonjour ! [geste:salut] Aujourd'hui...
 * `[émotion]` s'applique jusqu'à la prochaine balise d'émotion, `[geste:nom]` se
 * déclenche sur le mot qui suit. Les balises sont retirées du texte envoyé à Azure.
 */
export interface EmotionTag {
  kind: "emotion";
  emotion: string;
  /** Index du mot suivant dans le texte nettoyé. */
  wordIndex: number;
}

export interface GestureTag {
  kind: "gesture";
  gesture: string;
  wordIndex: number;
}

export type ScriptTag = EmotionTag | GestureTag;

export interface ParsedScript {
  /** Texte sans balises, espaces normalisés (les paragraphes sont conservés). */
  text: string;
  /** Mots du texte nettoyé (découpage sur les espaces). */
  words: string[];
  tags: ScriptTag[];
  warnings: string[];
}

const TAG_RE = /\[([^\[\]]+)\]/g;

export function parseScript(source: string, vocab: { emotions: string[]; gestures: string[] }): ParsedScript {
  const tags: ScriptTag[] = [];
  const warnings: string[] = [];
  const paragraphs: string[] = [];
  let wordIndex = 0;

  for (const rawParagraph of source.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const pieces: string[] = [];
    let last = 0;
    const pushText = (chunk: string) => {
      const words = chunk.split(/\s+/).filter(Boolean);
      pieces.push(...words);
      wordIndex += words.length;
    };
    for (const m of rawParagraph.matchAll(TAG_RE)) {
      pushText(rawParagraph.slice(last, m.index));
      last = m.index! + m[0].length;
      const inner = m[1].trim();
      const gesture = /^geste\s*:\s*(.+)$/i.exec(inner);
      if (gesture) {
        const name = gesture[1].trim().toLowerCase().replace(/\s+/g, "_");
        if (!vocab.gestures.includes(name)) {
          warnings.push(`balise [geste:${name}] inconnue, ignorée (gestes valides : ${vocab.gestures.join(", ")})`);
          continue;
        }
        tags.push({ kind: "gesture", gesture: name, wordIndex });
      } else {
        const name = inner.toLowerCase();
        if (!vocab.emotions.includes(name)) {
          warnings.push(`balise [${inner}] inconnue, ignorée (émotions valides : ${vocab.emotions.join(", ")})`);
          continue;
        }
        tags.push({ kind: "emotion", emotion: name, wordIndex });
      }
    }
    pushText(rawParagraph.slice(last));
    if (pieces.length) paragraphs.push(pieces.join(" "));
  }

  const text = paragraphs.join("\n\n");
  const words = text.split(/\s+/).filter(Boolean);
  // une balise placée tout à la fin s'accroche au dernier mot
  for (const t of tags) if (t.wordIndex >= words.length) t.wordIndex = Math.max(0, words.length - 1);
  return { text, words, tags, warnings };
}

export interface TimedWordLike {
  start: number;
  end: number;
}

/** Convertit les balises en pistes temporelles à partir des mots horodatés. */
export function tagsToTracks(tags: ScriptTag[], words: TimedWordLike[], duration: number, intensity = 0.8) {
  const expressions: { start: number; end: number; emotion: string; intensity: number; source: "balise" }[] = [];
  const gestures: { at: number; clip: string; source: "balise" }[] = [];
  const emotionTags = tags.filter((t): t is EmotionTag => t.kind === "emotion");
  for (let i = 0; i < emotionTags.length; i++) {
    const start = words[emotionTags[i].wordIndex]?.start ?? 0;
    const next = emotionTags[i + 1];
    const end = next ? (words[next.wordIndex]?.start ?? duration) : duration;
    if (end > start) expressions.push({ start, end, emotion: emotionTags[i].emotion, intensity, source: "balise" });
  }
  for (const t of tags) {
    if (t.kind !== "gesture") continue;
    const w = words[t.wordIndex];
    if (w) gestures.push({ at: w.start, clip: t.gesture, source: "balise" });
  }
  return { expressions, gestures };
}
