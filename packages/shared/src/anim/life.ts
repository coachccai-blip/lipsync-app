import type { BoneRotations, LifeConfig, MorphWeights } from "../types.js";
import { Prng } from "../prng.js";
import { clamp, smoothNoise, smoothstep } from "../math.js";

export interface GazeTarget {
  t: number;
  x: number;
  y: number;
}

/** Événements de « vie » précalculés pour toute la durée, à partir de la seed. */
export interface LifeSchedule {
  blinks: number[];
  gazes: GazeTarget[];
  headPhases: [number[], number[], number[]];
}

export function buildLifeSchedule(seed: number, duration: number, cfg: LifeConfig): LifeSchedule {
  const root = new Prng(seed);
  const blinkRng = root.fork("blink");
  const gazeRng = root.fork("gaze");
  const headRng = root.fork("head");

  const blinks: number[] = [];
  let t = blinkRng.range(0.4, 1.5);
  while (t < duration + 1) {
    blinks.push(t);
    if (blinkRng.chance(cfg.blink.doubleProbability)) {
      t += cfg.blink.duration + 0.09;
      blinks.push(t);
    }
    t += blinkRng.range(cfg.blink.minInterval, cfg.blink.maxInterval);
  }

  const gazes: GazeTarget[] = [{ t: 0, x: 0, y: 0 }];
  let g = gazeRng.range(cfg.gaze.minInterval, cfg.gaze.maxInterval);
  while (g < duration + 1) {
    // la plupart du temps proche du centre (regard caméra), parfois plus loin
    const far = gazeRng.chance(0.25);
    const amp = cfg.gaze.amplitude * (far ? 1 : 0.4);
    gazes.push({ t: g, x: gazeRng.range(-amp, amp), y: gazeRng.range(-amp * 0.6, amp * 0.5) });
    g += gazeRng.range(cfg.gaze.minInterval, cfg.gaze.maxInterval);
  }

  const phases = (): number[] => [headRng.range(0, 6.28), headRng.range(0, 6.28), headRng.range(0, 6.28)];
  return { blinks, gazes, headPhases: [phases(), phases(), phases()] };
}

/** Poids de clignement (0 = ouvert, 1 = fermé) à t. */
export function blinkAt(t: number, blinks: number[], duration: number): number {
  let w = 0;
  for (const b of blinks) {
    if (t < b) break;
    if (t > b + duration) continue;
    const phase = (t - b) / duration;
    // fermeture rapide (40 %), ouverture plus lente (60 %)
    w = Math.max(w, phase < 0.4 ? smoothstep(phase / 0.4) : 1 - smoothstep((phase - 0.4) / 0.6));
  }
  return w;
}

/** Direction du regard (-1..1 en x et y) à t, avec saccades adoucies. */
export function gazeAt(t: number, gazes: GazeTarget[], saccadeDuration: number): { x: number; y: number } {
  let prev = gazes[0];
  let next: GazeTarget | undefined;
  for (let i = 1; i < gazes.length; i++) {
    if (gazes[i].t <= t) prev = gazes[i];
    else {
      next = gazes[i];
      break;
    }
  }
  // interpolation depuis la cible précédente vers la cible courante au début de celle-ci
  const idx = gazes.indexOf(prev);
  if (idx > 0) {
    const before = gazes[idx - 1];
    const k = smoothstep((t - prev.t) / saccadeDuration);
    return { x: before.x + (prev.x - before.x) * k, y: before.y + (prev.y - before.y) * k };
  }
  void next;
  return { x: prev.x, y: prev.y };
}

export interface LifeState {
  morphs: MorphWeights;
  bones: BoneRotations;
}

/**
 * Couche 3 : vie procédurale. Clignements, micro-saccades du regard, respiration,
 * micro-mouvements de tête, haussement de sourcils et hochement sur les accents.
 */
export function lifeAt(t: number, schedule: LifeSchedule, cfg: LifeConfig, accents: number[]): LifeState {
  const morphs: MorphWeights = {};
  const bones: BoneRotations = {};
  if (!cfg.enabled) return { morphs, bones };

  const blink = blinkAt(t, schedule.blinks, cfg.blink.duration);
  if (blink > 0) {
    morphs.eyeBlinkLeft = blink;
    morphs.eyeBlinkRight = blink;
  }

  const gaze = gazeAt(t, schedule.gazes, cfg.gaze.duration);
  if (gaze.x > 0) {
    morphs.eyeLookOutRight = gaze.x;
    morphs.eyeLookInLeft = gaze.x;
  } else if (gaze.x < 0) {
    morphs.eyeLookOutLeft = -gaze.x;
    morphs.eyeLookInRight = -gaze.x;
  }
  if (gaze.y > 0) {
    morphs.eyeLookUpLeft = gaze.y;
    morphs.eyeLookUpRight = gaze.y;
  } else if (gaze.y < 0) {
    morphs.eyeLookDownLeft = -gaze.y;
    morphs.eyeLookDownRight = -gaze.y;
  }

  // accents : sourcils et hochement
  let brow = 0;
  let nod = 0;
  for (const a of accents) {
    if (t < a) break;
    const d = t - a;
    if (d < cfg.brows.duration) brow = Math.max(brow, Math.sin(Math.PI * (d / cfg.brows.duration)));
    if (d < 0.35) nod = Math.max(nod, Math.sin(Math.PI * (d / 0.35)));
  }
  if (brow > 0) {
    const r = cfg.brows.raiseOnAccent * brow;
    morphs.browInnerUp = r;
    morphs.browOuterUpLeft = r * 0.7;
    morphs.browOuterUpRight = r * 0.7;
  }

  const [px, py, pz] = schedule.headPhases;
  const amp = cfg.head.amplitude;
  bones.head = [
    amp * 0.7 * smoothNoise(t, px, cfg.head.speed) + cfg.head.nodOnAccent * nod,
    amp * smoothNoise(t, py, cfg.head.speed * 0.8),
    amp * 0.5 * smoothNoise(t, pz, cfg.head.speed * 0.6),
  ];
  // le regard entraîne légèrement la tête
  bones.head[1] += gaze.x * 3;
  bones.head[0] -= gaze.y * 2;

  const breath = Math.sin((2 * Math.PI * t) / cfg.breathing.period);
  bones.spine1 = [-cfg.breathing.amplitude * 0.5 * (breath + 1), 0, 0];
  bones.spine2 = [-cfg.breathing.amplitude * 0.5 * (breath + 1), 0, 0];

  for (const k in morphs) morphs[k] = clamp(morphs[k]);
  return { morphs, bones };
}
