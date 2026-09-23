import type { AllConfig, BoneRotations, MorphWeights, Performance } from "../types.js";
import { mouthWeightsAt, shapeWeightsAt, speakingFactorAt } from "./mouth.js";
import { emotionWeightsAt, expressionWeightsAt } from "./expressions.js";
import { buildLifeSchedule, lifeAt, type LifeSchedule } from "./life.js";
import { ProceduralGestureSource, type GestureSource } from "./gestures.js";
import { clamp } from "../math.js";

export interface FrameState {
  t: number;
  /** Pose de repos additive (config gestures.restPose), composée avant les rotations additives. */
  restPose: BoneRotations;
  /** Poids finaux de blendshapes (0..1), clé = nom canonique ARKit. */
  morphs: MorphWeights;
  /** Rotations additives d'os en degrés, clé = nom canonique. */
  bones: BoneRotations;
  /** Facteur de parole 0..1 (pour l'affichage). */
  speaking: number;
  /** Poids des formes de bouche Rhubarb (A..H, X), somme <= 1 : mode marionnette. */
  shapes: Record<string, number>;
  /** Poids de chaque émotion active (0..1) : mode marionnette. */
  emotions: Record<string, number>;
  /** Clignement 0 (ouvert) .. 1 (fermé). */
  blink: number;
  /**
   * Émotion affichée en mode marionnette : une seule image à la fois, changée uniquement
   * pendant un clignement (yeux fermés), jamais mélangée. undefined = yeux de base.
   */
  emotionDisplayed?: string;
}

export interface Animator {
  frameAt(t: number): FrameState;
  schedule: LifeSchedule;
  gestures: GestureSource;
}

/**
 * Combine les quatre couches en une fonction pure du temps. Utilisé à l'identique
 * par la prévisualisation et le rendu hors ligne.
 */
/** Émotion dominante (segments bruts, sans fondu) à t, au-dessus d'une intensité minimale. */
function dominantAt(t: number, perf: Performance, minIntensity: number): string | undefined {
  let best: { emotion: string; intensity: number } | undefined;
  for (const s of perf.expressions) {
    if (t >= s.start && t < s.end && s.emotion !== "neutre" && s.intensity >= minIntensity && (!best || s.intensity > best.intensity)) best = s;
  }
  return best?.emotion;
}

export function createAnimator(perf: Performance, cfg: AllConfig, gestures?: GestureSource): Animator {
  // un clignement à chaque frontière d'émotion : la bascule d'image se fait yeux fermés
  const boundaries = new Set<number>();
  for (const s of perf.expressions) {
    if (s.emotion === "neutre") continue;
    if (s.start > 0.05) boundaries.add(Math.round(s.start * 1000) / 1000);
    if (s.end < perf.duration - 0.05) boundaries.add(Math.round(s.end * 1000) / 1000);
  }
  const schedule = buildLifeSchedule(perf.seed, perf.duration, cfg.scene.life, [...boundaries]);
  const blinkClosedAt = cfg.scene.life.blink.duration * 0.4;
  const minIntensity = cfg.scene.marionnette?.emotionThreshold ?? 0.3;
  const gestureSource = gestures ?? new ProceduralGestureSource(perf.gestures, cfg.gestures);
  const test = (perf as Performance & { test?: boolean }).test === true;

  const frameAt = (t: number): FrameState => {
    const morphs: MorphWeights = {};
    const bones: BoneRotations = {};

    const speaking = speakingFactorAt(t, perf.visemes, cfg.visemes);
    const shapes = shapeWeightsAt(t, perf.visemes, cfg.visemes);
    const emotions = emotionWeightsAt(t, perf.expressions, cfg.emotions);
    const mouth = mouthWeightsAt(t, perf.visemes, perf.energy, cfg.visemes);
    const expr = expressionWeightsAt(t, perf.expressions, cfg.emotions, speaking);
    const life = lifeAt(t, schedule, cfg.scene.life, perf.accents);

    for (const k in expr) morphs[k] = (morphs[k] ?? 0) + expr[k];
    for (const k in life.morphs) morphs[k] = (morphs[k] ?? 0) + life.morphs[k];
    // la bouche a priorité : elle s'ajoute après les expressions déjà atténuées dans sa zone
    for (const k in mouth) morphs[k] = (morphs[k] ?? 0) + mouth[k];

    addBones(bones, life.bones);
    addBones(bones, gestureSource.bonesAt(t));

    if (test) {
      // animation de test du jalon 2 : rotation de tête + jawOpen sinusoïdal
      morphs.jawOpen = 0.5 + 0.5 * Math.sin(2 * Math.PI * t * 1.5);
      const head = bones.head ?? [0, 0, 0];
      bones.head = [head[0], head[1] + 20 * Math.sin(Math.PI * t), head[2]];
    }

    // image d'émotion : état échantillonné au dernier instant « yeux fermés » (ou à 0)
    let sample = 0;
    for (const b of schedule.blinks) {
      if (b + blinkClosedAt <= t) sample = b + blinkClosedAt;
      else break;
    }
    const emotionDisplayed = dominantAt(sample, perf, minIntensity);

    for (const k in morphs) morphs[k] = clamp(morphs[k]);
    return { t, morphs, bones, speaking, restPose: cfg.gestures.restPose ?? {}, shapes, emotions, blink: life.morphs.eyeBlinkLeft ?? 0, emotionDisplayed };
  };

  return { frameAt, schedule, gestures: gestureSource };
}

function addBones(target: BoneRotations, source: BoneRotations): void {
  for (const k in source) {
    const cur = target[k] ?? [0, 0, 0];
    target[k] = [cur[0] + source[k][0], cur[1] + source[k][1], cur[2] + source[k][2]];
  }
}
