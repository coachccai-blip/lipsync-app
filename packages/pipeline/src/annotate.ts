import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import type { ExpressionSegment, GestureEvent, Word } from "@avatar/shared";
import { normalizeToken, splitSentences } from "./align.js";
import { log } from "./log.js";

export interface AnnotationVocab {
  emotions: string[];
  gestures: string[];
}

export interface SentenceInput {
  index: number;
  start: number;
  end: number;
  text: string;
}

/** Réponse attendue du LLM (validée par schéma). */
export const AnnotationSchema = z.object({
  sentences: z.array(
    z.object({
      index: z.number().int().min(0),
      emotion: z.string(),
      intensity: z.number().min(0).max(1),
    }),
  ),
  gestures: z.array(
    z.object({
      sentence: z.number().int().min(0),
      /** Mot exact de la phrase sur lequel déclencher le geste. */
      word: z.string(),
      clip: z.string(),
    }),
  ),
});

export type Annotation = z.infer<typeof AnnotationSchema>;

export interface Annotator {
  readonly name: string;
  annotate(sentences: SentenceInput[], vocab: AnnotationVocab): Promise<Annotation>;
}

/** Aucune annotation (option --sans-llm) : tout est procédural et issu des balises. */
export class NoopAnnotator implements Annotator {
  readonly name = "aucun";
  async annotate(): Promise<Annotation> {
    return { sentences: [], gestures: [] };
  }
}

export function buildPrompt(sentences: SentenceInput[], vocab: AnnotationVocab): { system: string; user: string } {
  const system = [
    "Tu es directeur d'acteurs pour un personnage 3D cartoon qui présente un texte face caméra, en français.",
    "Tu reçois le texte découpé en phrases avec leurs horodatages (secondes).",
    "Pour chaque phrase, choisis une émotion et une intensité (0 à 1). Place éventuellement des gestes sur des mots précis.",
    "",
    `Émotions autorisées (uniquement) : ${vocab.emotions.join(", ")}.`,
    `Gestes autorisés (uniquement) : ${vocab.gestures.join(", ")}.`,
    "",
    "Sobriété : au plus un geste marqué toutes les 4 à 6 secondes. Le reste du temps, aucun geste (posture d'écoute active).",
    "Les émotions doivent rester crédibles et peu nombreuses : « neutre » est un bon choix par défaut, ne change d'émotion que quand le texte le justifie.",
    "Le champ « word » d'un geste doit reprendre exactement un mot de la phrase indiquée.",
    "Réponds uniquement avec le JSON demandé.",
  ].join("\n");
  const user = sentences.map((s) => `${s.index}. [${s.start.toFixed(2)} → ${s.end.toFixed(2)}] ${s.text}`).join("\n");
  return { system, user };
}

/**
 * Annotation par l'API Anthropic : JSON structuré validé par schéma, une nouvelle
 * tentative en cas d'échec, puis repli sur neutre sans geste.
 */
export class AnthropicAnnotator implements Annotator {
  readonly name: string;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: { client?: Anthropic; model?: string } = {}) {
    this.client = options.client ?? new Anthropic();
    this.model = options.model ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-5";
    this.name = `anthropic:${this.model}`;
  }

  async annotate(sentences: SentenceInput[], vocab: AnnotationVocab): Promise<Annotation> {
    if (sentences.length === 0) return { sentences: [], gestures: [] };
    const { system, user } = buildPrompt(sentences, vocab);
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await this.client.messages.parse({
          model: this.model,
          max_tokens: 16000,
          system,
          messages: [{ role: "user", content: user }],
          output_config: { format: zodOutputFormat(AnnotationSchema) },
        });
        if (response.stop_reason === "refusal") throw new Error("le modèle a refusé la demande");
        const parsed = response.parsed_output;
        if (!parsed) throw new Error("réponse non conforme au schéma");
        return AnnotationSchema.parse(parsed);
      } catch (e) {
        lastError = e;
        log.warn(`Annotation LLM : ${(e as Error).message} (tentative ${attempt}/2)`);
      }
    }
    log.warn(`Annotation LLM abandonnée (${(lastError as Error)?.message}) : repli sur neutre sans geste.`);
    return { sentences: [], gestures: [] };
  }
}

/** Filtre les valeurs hors vocabulaire (avertissement) et convertit l'annotation en pistes temporelles. */
export function annotationToTracks(
  annotation: Annotation,
  sentences: ReturnType<typeof splitSentences>,
  vocab: AnnotationVocab,
  options: { minGestureGap?: number; warn?: (msg: string) => void } = {},
): { expressions: ExpressionSegment[]; gestures: GestureEvent[] } {
  const warn = options.warn ?? log.warn;
  const minGap = options.minGestureGap ?? 4;
  const expressions: ExpressionSegment[] = [];
  for (const s of annotation.sentences) {
    const sentence = sentences[s.index];
    if (!sentence) continue;
    if (!vocab.emotions.includes(s.emotion)) {
      warn(`annotation : émotion « ${s.emotion} » hors vocabulaire, remplacée par neutre`);
      continue;
    }
    if (s.emotion === "neutre") continue;
    expressions.push({ start: sentence.start, end: sentence.end, emotion: s.emotion, intensity: Math.min(1, Math.max(0, s.intensity)), source: "llm" });
  }
  // fusion des segments adjacents de même émotion
  expressions.sort((a, b) => a.start - b.start);
  const merged: ExpressionSegment[] = [];
  for (const e of expressions) {
    const last = merged[merged.length - 1];
    if (last && last.emotion === e.emotion && e.start - last.end < 0.5) {
      last.end = e.end;
      last.intensity = Math.max(last.intensity, e.intensity);
    } else merged.push({ ...e });
  }

  const gestures: GestureEvent[] = [];
  const candidates: GestureEvent[] = [];
  for (const g of annotation.gestures) {
    const sentence = sentences[g.sentence];
    if (!sentence) continue;
    if (!vocab.gestures.includes(g.clip)) {
      warn(`annotation : geste « ${g.clip} » hors vocabulaire, ignoré`);
      continue;
    }
    const target = normalizeToken(g.word);
    const word: Word = sentence.words.find((w) => normalizeToken(w.w) === target) ?? sentence.words[0];
    candidates.push({ at: word.start, clip: g.clip, source: "llm" });
  }
  candidates.sort((a, b) => a.at - b.at);
  let last = -Infinity;
  for (const g of candidates) {
    if (g.at - last < minGap) continue;
    gestures.push(g);
    last = g.at;
  }
  return { expressions: merged, gestures };
}

export { splitSentences };
