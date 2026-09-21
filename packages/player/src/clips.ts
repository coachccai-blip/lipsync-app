import * as THREE from "three";
import { envelope, normalizeName, type BoneConfig, type BoneRotations, type GestureConfig, type GestureEvent, type GestureSource } from "@avatar/shared";
import type { LoadedModel } from "./model.js";

interface ClipEntry {
  action: THREE.AnimationAction;
  duration: number;
}

/**
 * Retargeting par table de correspondance de noms d'os : chaque piste
 * `<osSource>.<propriété>` est renommée vers l'os du modèle portant le même nom canonique.
 * Seules les pistes de rotation du haut du corps sont conservées (bassin et jambes verrouillés).
 * Aucune correction de pose de repos : fonctionne quand les squelettes ont la même pose de repos.
 */
export function retargetClip(clip: THREE.AnimationClip, model: LoadedModel, boneCfg: BoneConfig): { clip: THREE.AnimationClip; dropped: string[] } {
  const canonicalByNorm = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(boneCfg.aliases)) {
    canonicalByNorm.set(normalizeName(canonical), canonical);
    for (const a of aliases) canonicalByNorm.set(normalizeName(a), canonical);
  }
  const upper = new Set(boneCfg.upperBody);
  const tracks: THREE.KeyframeTrack[] = [];
  const dropped: string[] = [];
  for (const track of clip.tracks) {
    const m = /^([^.]+)\.(quaternion|position|scale)(\[.*\])?$/.exec(track.name);
    if (!m) {
      dropped.push(track.name);
      continue;
    }
    const [, node, prop] = m;
    if (prop !== "quaternion") {
      dropped.push(track.name);
      continue;
    }
    const canonical = canonicalByNorm.get(normalizeName(node));
    const target = canonical ? model.bones.get(canonical) : undefined;
    if (!canonical || !target || !upper.has(canonical)) {
      dropped.push(track.name);
      continue;
    }
    const copy = track.clone();
    copy.name = `${target.bone.name}.quaternion`;
    tracks.push(copy);
  }
  return { clip: new THREE.AnimationClip(clip.name, clip.duration, tracks), dropped };
}

/**
 * Couche 4 (clips) : AnimationMixer piloté uniquement par le temps t (jamais par
 * l'horloge). Clip de base en boucle + clips ponctuels avec fondu, normalisation des poids.
 */
export class ClipGestureSource implements GestureSource {
  readonly mixer: THREE.AnimationMixer;
  private readonly clips = new Map<string, ClipEntry>();
  private idle?: ClipEntry;
  readonly resolved: string[] = [];
  readonly missing: string[] = [];
  readonly warnings: string[] = [];

  constructor(
    private readonly model: LoadedModel,
    private readonly events: GestureEvent[],
    private readonly cfg: GestureConfig,
    boneCfg: BoneConfig,
    external: Map<string, THREE.AnimationClip[]>,
  ) {
    this.mixer = new THREE.AnimationMixer(model.root);
    const byName = new Map<string, THREE.AnimationClip>();
    for (const c of model.animations) byName.set(normalizeName(c.name), c);
    for (const [file, clips] of external) for (const c of clips) byName.set(normalizeName(`${file}:${c.name}`), c), byName.set(normalizeName(c.name), c);

    const prepare = (name: string, ref: { clip?: string; file?: string }): ClipEntry | undefined => {
      const key = ref.clip ?? name;
      const source = byName.get(normalizeName(ref.file ? `${ref.file}:${key}` : key)) ?? byName.get(normalizeName(key));
      if (!source) return undefined;
      const { clip, dropped } = retargetClip(source, model, boneCfg);
      if (clip.tracks.length === 0) {
        this.warnings.push(`clip « ${key} » : aucune piste utilisable après retargeting (${dropped.length} pistes ignorées)`);
        return undefined;
      }
      if (dropped.length) this.warnings.push(`clip « ${key} » : ${dropped.length} piste(s) ignorée(s) (hors haut du corps ou os introuvable)`);
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 0);
      action.clampWhenFinished = true;
      action.enabled = true;
      action.play();
      action.paused = true;
      return { action, duration: clip.duration };
    };

    if (cfg.idle.clip) {
      this.idle = prepare("idle", { clip: cfg.idle.clip });
      if (this.idle) this.idle.action.setLoop(THREE.LoopRepeat, Infinity);
      else this.warnings.push(`clip de repos « ${cfg.idle.clip} » introuvable : balancement procédural`);
    }
    for (const [name, ref] of Object.entries(cfg.clips)) {
      const entry = prepare(name, ref);
      if (entry) {
        this.clips.set(name, entry);
        this.resolved.push(name);
      } else this.missing.push(name);
    }
  }

  available(): string[] {
    return [...this.clips.keys()];
  }

  /** Les clips agissent directement sur les os via le mixer ; rien d'additif ici (sauf balancement de repos). */
  bonesAt(t: number): BoneRotations {
    if (this.idle) return {};
    const idle = this.cfg.idle;
    if (idle.swayAmplitude <= 0) return {};
    const s = Math.sin((2 * Math.PI * t) / idle.swayPeriod);
    return { spine: [0, idle.swayAmplitude * s, idle.swayAmplitude * 0.35 * Math.sin((2 * Math.PI * t) / (idle.swayPeriod * 1.7))] };
  }

  /** Positionne toutes les actions à l'instant t puis évalue le mixer (pas fixe, dt = 0). */
  update(t: number): void {
    const fade = this.cfg.fadeMs / 1000;
    let sum = 0;
    const active: { entry: ClipEntry; w: number; local: number }[] = [];
    for (const ev of this.events) {
      const entry = this.clips.get(ev.clip);
      if (!entry) continue;
      const local = t - ev.at;
      if (local < -fade || local > entry.duration + fade) continue;
      const w = envelope(t, ev.at, ev.at + entry.duration, fade);
      if (w <= 0) continue;
      active.push({ entry, w, local: Math.min(Math.max(local, 0), entry.duration - 1e-4) });
      sum += w;
    }
    const norm = sum > 1 ? 1 / sum : 1;
    for (const entry of this.clips.values()) entry.action.setEffectiveWeight(0);
    for (const a of active) {
      a.entry.action.setEffectiveWeight(a.w * norm * this.cfg.intensity);
      a.entry.action.time = a.local;
    }
    if (this.idle) {
      this.idle.action.setEffectiveWeight(Math.max(0, 1 - Math.min(1, sum)));
      this.idle.action.time = this.idle.duration > 0 ? t % this.idle.duration : 0;
    }
    this.mixer.update(0);
  }
}
