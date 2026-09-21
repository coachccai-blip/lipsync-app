import type { EnergyTrack, MorphWeights, VisemeConfig, VisemeCue } from "../types.js";
import { clamp, envelope, lerp } from "../math.js";

/** Valeur d'énergie (0..1) interpolée à l'instant t. */
export function energyAt(t: number, energy: EnergyTrack | undefined): number {
  if (!energy || energy.values.length === 0) return 0.5;
  const pos = t * energy.rate;
  const i = Math.floor(pos);
  if (i < 0) return energy.values[0];
  if (i >= energy.values.length - 1) return energy.values[energy.values.length - 1];
  return lerp(energy.values[i], energy.values[i + 1], pos - i);
}

/** Index du premier visème dont la fin est >= t (recherche dichotomique sur une liste triée). */
function firstCueEndingAfter(visemes: VisemeCue[], t: number): number {
  let lo = 0;
  let hi = visemes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (visemes[mid].end < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Poids bruts de chaque forme Rhubarb à l'instant t (avec anticipation et transitions), somme <= 1. */
export function shapeWeightsAt(t: number, visemes: VisemeCue[], cfg: VisemeConfig): Record<string, number> {
  const T = cfg.transitionMs / 1000;
  const ts = t + cfg.anticipationMs / 1000;
  const out: Record<string, number> = {};
  let sum = 0;
  for (let i = firstCueEndingAfter(visemes, ts - T); i < visemes.length; i++) {
    const cue = visemes[i];
    if (cue.start > ts + T) break;
    const w = envelope(ts, cue.start, cue.end, T);
    if (w <= 0) continue;
    out[cue.shape] = (out[cue.shape] ?? 0) + w;
    sum += w;
  }
  if (sum > 1) for (const k in out) out[k] /= sum;
  return out;
}

/** Vrai si une forme autre que le repos (X) est active à t. Renvoie un facteur 0..1 (fondu). */
export function speakingFactorAt(t: number, visemes: VisemeCue[], cfg: VisemeConfig): number {
  const weights = shapeWeightsAt(t, visemes, cfg);
  let s = 0;
  for (const k in weights) if (k !== "X") s += weights[k];
  return clamp(s);
}

/**
 * Couche 1 : la bouche. Poids de blendshapes ARKit à l'instant t.
 * - interpolation adoucie entre formes (transitionMs)
 * - anticipation (anticipationMs)
 * - jawOpen modulé par l'énergie audio locale
 * - facteur d'exagération global
 */
export function mouthWeightsAt(t: number, visemes: VisemeCue[], energy: EnergyTrack | undefined, cfg: VisemeConfig): MorphWeights {
  const shapes = shapeWeightsAt(t, visemes, cfg);
  const out: MorphWeights = {};
  for (const shape in shapes) {
    const pose = cfg.shapes[shape as keyof typeof cfg.shapes] ?? {};
    const w = shapes[shape];
    for (const k in pose) out[k] = (out[k] ?? 0) + pose[k] * w;
  }
  if (out.jawOpen) {
    const e = energyAt(t, energy);
    const factor = lerp(1 - 0.5 * cfg.energyInfluence, 1 + 0.5 * cfg.energyInfluence, e);
    out.jawOpen *= factor;
  }
  for (const k in out) out[k] = clamp(out[k] * cfg.exaggeration);
  return out;
}
