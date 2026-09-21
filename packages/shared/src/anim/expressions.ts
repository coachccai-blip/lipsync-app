import type { EmotionConfig, ExpressionSegment, MorphWeights } from "../types.js";
import { clamp, envelope, lerp } from "../math.js";

/**
 * Couche 2 : les expressions. Chaque segment est une pose de blendshapes pondérée par
 * son intensité et un fondu (fadeMs) à ses bornes. Les blendshapes de la zone bouche
 * sont atténués proportionnellement à `speakingFactor` (0 = silence, 1 = parole).
 */
export function expressionWeightsAt(t: number, segments: ExpressionSegment[], cfg: EmotionConfig, speakingFactor = 0): MorphWeights {
  const fade = cfg.fadeMs / 1000;
  const mouthAtten = lerp(1, cfg.speechAttenuation, clamp(speakingFactor));
  const mouthZone = new Set(cfg.mouthZone);
  const out: MorphWeights = {};
  for (const seg of segments) {
    if (t < seg.start - fade || t > seg.end + fade) continue;
    const w = envelope(t, seg.start, seg.end, fade) * clamp(seg.intensity);
    if (w <= 0) continue;
    const pose = cfg.emotions[seg.emotion];
    if (!pose) continue;
    for (const k in pose) {
      const f = mouthZone.has(k) ? mouthAtten : 1;
      out[k] = (out[k] ?? 0) + pose[k] * w * f;
    }
  }
  for (const k in out) out[k] = clamp(out[k]);
  return out;
}

/** Émotion dominante à t (pour l'affichage des pistes). */
export function dominantEmotionAt(t: number, segments: ExpressionSegment[]): string | undefined {
  let best: ExpressionSegment | undefined;
  for (const s of segments) if (t >= s.start && t < s.end && (!best || s.intensity > best.intensity)) best = s;
  return best?.emotion;
}
