import type { BoneRotations, GestureConfig, GestureEvent, ProceduralGesture } from "../types.js";
import { easeInOutSine, envelope } from "../math.js";

/** Interface commune aux sources de gestes (clips mélangés ou procédural). */
export interface GestureSource {
  /** Rotations additionnelles d'os (degrés) à l'instant t. */
  bonesAt(t: number): BoneRotations;
  /** Noms de gestes disponibles. */
  available(): string[];
}

function addBones(target: BoneRotations, source: BoneRotations, factor: number): void {
  for (const k in source) {
    const cur = target[k] ?? [0, 0, 0];
    const s = source[k];
    target[k] = [cur[0] + s[0] * factor, cur[1] + s[1] * factor, cur[2] + s[2] * factor];
  }
}

/** Pose interpolée d'un geste procédural à `local` secondes de son début. */
export function proceduralPoseAt(local: number, gesture: ProceduralGesture): BoneRotations {
  const kfs = gesture.keyframes;
  if (kfs.length === 0 || local < 0 || local > gesture.duration) return {};
  let i = 0;
  while (i < kfs.length - 1 && kfs[i + 1].t <= local) i++;
  const a = kfs[i];
  const b = kfs[Math.min(i + 1, kfs.length - 1)];
  const span = b.t - a.t;
  const k = span > 0 ? easeInOutSine((local - a.t) / span) : 1;
  const out: BoneRotations = {};
  const names = new Set([...Object.keys(a.bones), ...Object.keys(b.bones)]);
  for (const n of names) {
    const ra = a.bones[n] ?? [0, 0, 0];
    const rb = b.bones[n] ?? [0, 0, 0];
    out[n] = [ra[0] + (rb[0] - ra[0]) * k, ra[1] + (rb[1] - ra[1]) * k, ra[2] + (rb[2] - ra[2]) * k];
  }
  return out;
}

/**
 * Couche 4 (repli procédural) : posture d'attente + gestes ponctuels décrits par images clés.
 * Les gestes sont additifs sur la pose de repos du modèle ; en cas de chevauchement, la
 * somme des poids est normalisée pour éviter les déformations.
 */
export class ProceduralGestureSource implements GestureSource {
  constructor(private readonly events: GestureEvent[], private readonly cfg: GestureConfig) {}

  available(): string[] {
    return Object.keys(this.cfg.procedural);
  }

  bonesAt(t: number): BoneRotations {
    const out: BoneRotations = {};
    const idle = this.cfg.idle;
    if (idle.swayAmplitude > 0) {
      const s = Math.sin((2 * Math.PI * t) / idle.swayPeriod);
      out.spine = [0, idle.swayAmplitude * s, idle.swayAmplitude * 0.35 * Math.sin((2 * Math.PI * t) / (idle.swayPeriod * 1.7))];
    }
    const fade = this.cfg.fadeMs / 1000;
    const active: { pose: BoneRotations; w: number }[] = [];
    let sum = 0;
    for (const ev of this.events) {
      const def = this.cfg.procedural[ev.clip];
      if (!def) continue;
      const local = t - ev.at;
      if (local < -fade || local > def.duration + fade) continue;
      const w = envelope(t, ev.at, ev.at + def.duration, fade);
      if (w <= 0) continue;
      active.push({ pose: proceduralPoseAt(Math.min(Math.max(local, 0), def.duration), def), w });
      sum += w;
    }
    const norm = sum > 1 ? 1 / sum : 1;
    for (const a of active) addBones(out, a.pose, a.w * norm * this.cfg.intensity);
    return out;
  }
}

/** Geste actif à t (affichage des pistes). */
export function activeGestureAt(t: number, events: GestureEvent[], cfg: GestureConfig): GestureEvent | undefined {
  for (const ev of events) {
    const dur = cfg.procedural[ev.clip]?.duration ?? 1.5;
    if (t >= ev.at && t < ev.at + dur) return ev;
  }
  return undefined;
}
