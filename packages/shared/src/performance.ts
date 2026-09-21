import type { Performance, RhubarbShape } from "./types.js";

export const RHUBARB_SHAPES: RhubarbShape[] = ["A", "B", "C", "D", "E", "F", "G", "H", "X"];
export const TRACK_SOURCES = ["llm", "balise", "procedural", "manuel", "test"];

/** Schéma JSON de performance.json (documentation + validation externe). */
export const PERFORMANCE_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://avatar-studio/performance.schema.json",
  title: "Avatar Studio performance",
  type: "object",
  required: ["version", "fps", "duration", "audio", "text", "words", "visemes", "energy", "accents", "expressions", "gestures", "seed"],
  additionalProperties: true,
  properties: {
    version: { const: 1 },
    fps: { type: "number", exclusiveMinimum: 0, maximum: 120 },
    duration: { type: "number", minimum: 0 },
    audio: { type: "string", minLength: 1 },
    text: { type: "string" },
    words: {
      type: "array",
      items: {
        type: "object",
        required: ["w", "start", "end"],
        properties: { w: { type: "string" }, start: { type: "number", minimum: 0 }, end: { type: "number", minimum: 0 } },
      },
    },
    visemes: {
      type: "array",
      items: {
        type: "object",
        required: ["start", "end", "shape"],
        properties: {
          start: { type: "number", minimum: 0 },
          end: { type: "number", minimum: 0 },
          shape: { type: "string", enum: RHUBARB_SHAPES },
        },
      },
    },
    energy: {
      type: "object",
      required: ["rate", "values"],
      properties: { rate: { type: "number", exclusiveMinimum: 0 }, values: { type: "array", items: { type: "number" } } },
    },
    accents: { type: "array", items: { type: "number", minimum: 0 } },
    expressions: {
      type: "array",
      items: {
        type: "object",
        required: ["start", "end", "emotion", "intensity"],
        properties: {
          start: { type: "number", minimum: 0 },
          end: { type: "number", minimum: 0 },
          emotion: { type: "string" },
          intensity: { type: "number", minimum: 0, maximum: 1 },
          source: { type: "string", enum: TRACK_SOURCES },
        },
      },
    },
    gestures: {
      type: "array",
      items: {
        type: "object",
        required: ["at", "clip"],
        properties: { at: { type: "number", minimum: 0 }, clip: { type: "string" }, source: { type: "string", enum: TRACK_SOURCES } },
      },
    },
    seed: { type: "integer" },
    padding: {
      type: "object",
      properties: { before: { type: "number", minimum: 0 }, after: { type: "number", minimum: 0 } },
    },
  },
} as const;

export class PerformanceValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`performance.json invalide :\n  - ${problems.join("\n  - ")}`);
    this.name = "PerformanceValidationError";
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/**
 * Valide un objet lu depuis performance.json et renvoie une Performance typée.
 * Les messages sont pensés pour un fichier édité à la main (chemin + valeur fautive).
 */
export function validatePerformance(input: unknown, options: { knownEmotions?: string[]; knownGestures?: string[] } = {}): Performance {
  const problems: string[] = [];
  const warn = (msg: string) => problems.push(msg);

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PerformanceValidationError(["la racine doit être un objet JSON { ... }"]);
  }
  const p = input as Record<string, unknown>;

  if (p.version !== 1) warn(`version : attendu 1, reçu ${JSON.stringify(p.version)}`);
  if (!isNum(p.fps) || p.fps <= 0 || p.fps > 120) warn(`fps : nombre attendu entre 1 et 120, reçu ${JSON.stringify(p.fps)}`);
  if (!isNum(p.duration) || p.duration < 0) warn(`duration : nombre positif attendu, reçu ${JSON.stringify(p.duration)}`);
  if (!isStr(p.audio) || p.audio.length === 0) warn(`audio : nom de fichier attendu, reçu ${JSON.stringify(p.audio)}`);
  if (!isStr(p.text)) warn(`text : chaîne attendue`);
  if (!Number.isInteger(p.seed)) warn(`seed : entier attendu, reçu ${JSON.stringify(p.seed)}`);

  const checkArray = (key: string): unknown[] => {
    if (!Array.isArray(p[key])) {
      warn(`${key} : tableau attendu`);
      return [];
    }
    return p[key] as unknown[];
  };

  checkArray("words").forEach((w, i) => {
    const o = w as Record<string, unknown>;
    if (!o || !isStr(o.w) || !isNum(o.start) || !isNum(o.end)) warn(`words[${i}] : attendu { w, start, end }, reçu ${JSON.stringify(w)}`);
    else if (o.end < o.start) warn(`words[${i}] ("${o.w}") : end (${o.end}) < start (${o.start})`);
  });

  let prevEnd = -1;
  checkArray("visemes").forEach((v, i) => {
    const o = v as Record<string, unknown>;
    if (!o || !isNum(o.start) || !isNum(o.end) || !isStr(o.shape)) {
      warn(`visemes[${i}] : attendu { start, end, shape }, reçu ${JSON.stringify(v)}`);
      return;
    }
    if (!RHUBARB_SHAPES.includes(o.shape as RhubarbShape)) warn(`visemes[${i}].shape : "${o.shape}" inconnu (valeurs : ${RHUBARB_SHAPES.join(", ")})`);
    if (o.end < o.start) warn(`visemes[${i}] : end (${o.end}) < start (${o.start})`);
    if (o.start < prevEnd - 1e-6) warn(`visemes[${i}] : commence (${o.start}) avant la fin du précédent (${prevEnd}) ; les visèmes doivent être triés et sans chevauchement`);
    prevEnd = o.end;
  });

  const energy = p.energy as Record<string, unknown> | undefined;
  if (!energy || typeof energy !== "object" || !isNum(energy.rate) || energy.rate <= 0 || !Array.isArray(energy.values)) {
    warn(`energy : attendu { rate: nombre > 0, values: [nombres] }`);
  } else if ((energy.values as unknown[]).some((x) => !isNum(x))) {
    warn(`energy.values : toutes les valeurs doivent être des nombres`);
  }

  checkArray("accents").forEach((a, i) => {
    if (!isNum(a) || a < 0) warn(`accents[${i}] : temps en secondes attendu, reçu ${JSON.stringify(a)}`);
  });

  checkArray("expressions").forEach((e, i) => {
    const o = e as Record<string, unknown>;
    if (!o || !isNum(o.start) || !isNum(o.end) || !isStr(o.emotion) || !isNum(o.intensity)) {
      warn(`expressions[${i}] : attendu { start, end, emotion, intensity, source }, reçu ${JSON.stringify(e)}`);
      return;
    }
    if (o.end < o.start) warn(`expressions[${i}] : end (${o.end}) < start (${o.start})`);
    if (o.intensity < 0 || o.intensity > 1) warn(`expressions[${i}].intensity : attendu entre 0 et 1, reçu ${o.intensity}`);
    if (options.knownEmotions && !options.knownEmotions.includes(o.emotion)) {
      warn(`expressions[${i}].emotion : "${o.emotion}" inconnue (valeurs : ${options.knownEmotions.join(", ")})`);
    }
    if (o.source !== undefined && !TRACK_SOURCES.includes(String(o.source))) warn(`expressions[${i}].source : "${o.source}" inconnu (valeurs : ${TRACK_SOURCES.join(", ")})`);
  });

  checkArray("gestures").forEach((g, i) => {
    const o = g as Record<string, unknown>;
    if (!o || !isNum(o.at) || !isStr(o.clip)) {
      warn(`gestures[${i}] : attendu { at, clip, source }, reçu ${JSON.stringify(g)}`);
      return;
    }
    if (options.knownGestures && !options.knownGestures.includes(o.clip)) {
      warn(`gestures[${i}].clip : "${o.clip}" inconnu (valeurs : ${options.knownGestures.join(", ")})`);
    }
  });

  if (p.padding !== undefined) {
    const pad = p.padding as Record<string, unknown>;
    if (!pad || !isNum(pad.before) || !isNum(pad.after)) warn(`padding : attendu { before, after } en secondes`);
  }

  if (problems.length) throw new PerformanceValidationError(problems);

  const perf = p as unknown as Performance;
  for (const e of perf.expressions) if (!e.source) e.source = "manuel";
  for (const g of perf.gestures) if (!g.source) g.source = "manuel";
  return perf;
}

/** Trie les pistes temporelles (les fichiers édités à la main ne le sont pas toujours). */
export function normalizePerformance(perf: Performance): Performance {
  perf.words.sort((a, b) => a.start - b.start);
  perf.visemes.sort((a, b) => a.start - b.start);
  perf.expressions.sort((a, b) => a.start - b.start);
  perf.gestures.sort((a, b) => a.at - b.at);
  perf.accents.sort((a, b) => a - b);
  return perf;
}
