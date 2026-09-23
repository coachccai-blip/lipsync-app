import { energyAt, smoothstep, type EnergyTrack, type FrameState, type MarionnetteConfig, type SceneConfig } from "@avatar/shared";
import { layoutBubble } from "./bubble.js";
import type { LoadReport } from "./api.js";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PuppetManifest {
  base: string;
  mouths: Record<string, string>;
  eyes?: { half?: string; closed?: string };
  emotions?: Record<string, string>;
  /** Couleur de fond à rendre transparente ("auto" = coins de l'image, null = conserver). */
  keyColor?: string | "auto" | null;
  keyTolerance?: number;
  regions?: { mouth: Rect; eyes: Rect } | null;
}

interface Layer {
  canvas: HTMLCanvasElement;
  rect: Rect;
}

const DIFF_THRESHOLD = 120;

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image introuvable : ${url}`));
    img.src = url;
  });
}

function toImageData(img: HTMLImageElement): ImageData {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/** Couleur moyenne des quatre coins (fond uni). */
export function cornerColor(data: Uint8ClampedArray, w: number, h: number): [number, number, number] {
  const pts = [[8, 8], [w - 9, 8], [8, h - 9], [w - 9, h - 9]];
  const acc = [0, 0, 0];
  for (const [x, y] of pts) {
    const i = (y * w + x) * 4;
    acc[0] += data[i];
    acc[1] += data[i + 1];
    acc[2] += data[i + 2];
  }
  return [acc[0] / 4, acc[1] / 4, acc[2] / 4];
}

/** Rend transparent ce qui est proche de la couleur de fond (bords adoucis). */
export function keyOut(img: ImageData, key: [number, number, number], tolerance: number): void {
  const d = img.data;
  const t0 = tolerance * 0.5 * 255;
  const t1 = tolerance * 1.5 * 255;
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.max(Math.abs(d[i] - key[0]), Math.abs(d[i + 1] - key[1]), Math.abs(d[i + 2] - key[2]));
    const a = smoothstep((dist - t0) / (t1 - t0));
    d[i + 3] = Math.round(d[i + 3] * a);
  }
}

/**
 * Boîte englobante des zones qui diffèrent de la base. Le masque de différence est agrégé en
 * blocs de 16 px ; seuls les blocs densément modifiés comptent, ce qui ignore le bruit diffus
 * (légères variations de fond ou de lumière). Renvoie null si rien ne diffère nettement.
 */
export function diffRect(base: Uint8ClampedArray, other: Uint8ClampedArray, w: number, h: number, exclude?: Rect, block = 16, density = 0.3): Rect | null {
  const bw = Math.ceil(w / block);
  const bh = Math.ceil(h / block);
  const counts = new Uint32Array(bw * bh);
  for (let y = 0; y < h; y++) {
    const by = Math.floor(y / block) * bw;
    for (let x = 0; x < w; x++) {
      if (exclude && x >= exclude.x && x < exclude.x + exclude.w && y >= exclude.y && y < exclude.y + exclude.h) continue;
      const i = (y * w + x) * 4;
      const diff = Math.abs(base[i] - other[i]) + Math.abs(base[i + 1] - other[i + 1]) + Math.abs(base[i + 2] - other[i + 2]);
      if (diff > DIFF_THRESHOLD) counts[by + Math.floor(x / block)]++;
    }
  }
  const minCount = block * block * density;
  let x0 = bw;
  let y0 = bh;
  let x1 = -1;
  let y1 = -1;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      if (counts[by * bw + bx] < minCount) continue;
      if (bx < x0) x0 = bx;
      if (bx > x1) x1 = bx;
      if (by < y0) y0 = by;
      if (by > y1) y1 = by;
    }
  }
  if (x1 < 0) return null;
  const x = x0 * block;
  const y = y0 * block;
  return { x, y, w: Math.min(w, (x1 + 1) * block) - x, h: Math.min(h, (y1 + 1) * block) - y };
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function padRect(r: Rect, pad: number, w: number, h: number): Rect {
  const x = Math.max(0, r.x - pad);
  const y = Math.max(0, r.y - pad);
  return { x, y, w: Math.min(w - x, r.w + 2 * pad), h: Math.min(h - y, r.h + 2 * pad) };
}

/** Découpe une zone d'une image en calque aux bords adoucis. */
function makeLayer(img: ImageData, rect: Rect, feather: number): Layer {
  const c = document.createElement("canvas");
  c.width = rect.w;
  c.height = rect.h;
  const ctx = c.getContext("2d")!;
  const src = document.createElement("canvas");
  src.width = img.width;
  src.height = img.height;
  src.getContext("2d")!.putImageData(img, 0, 0);
  ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  if (feather > 0) {
    const mask = ctx.createImageData(rect.w, rect.h);
    const m = mask.data;
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) {
        const dEdge = Math.min(x + 1, y + 1, rect.w - x, rect.h - y);
        const a = Math.min(1, dEdge / feather);
        const i = (y * rect.w + x) * 4;
        m[i + 3] = Math.round(255 * smoothstep(a));
      }
    }
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = rect.w;
    maskCanvas.height = rect.h;
    maskCanvas.getContext("2d")!.putImageData(mask, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }
  return { canvas: c, rect };
}

/**
 * Marionnette 2D : image de base + calques de bouches (formes Rhubarb), d'yeux (clignement)
 * et d'émotions (sourcils et yeux), tous découpés dans des images alignées sur la base.
 */
export class Puppet {
  width = 0;
  height = 0;
  base!: HTMLCanvasElement;
  mouths = new Map<string, Layer>();
  eyes: { half?: Layer; closed?: Layer } = {};
  emotions = new Map<string, Layer>();
  regions!: { mouth: Rect; eyes: Rect };
  report!: LoadReport;
  private images = new Map<string, ImageData>();
  private feather = 0;

  static async load(manifestUrl: string, cfg: MarionnetteConfig): Promise<Puppet> {
    const res = await fetch(manifestUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`manifeste introuvable : ${manifestUrl} (HTTP ${res.status})`);
    const manifest = (await res.json()) as PuppetManifest;
    const resolve = (file: string) => new URL(file, new URL(manifestUrl, location.href)).toString();
    const p = new Puppet();
    const warnings: string[] = [];
    const entries: [string, string][] = [["base", manifest.base]];
    for (const [k, f] of Object.entries(manifest.mouths ?? {})) entries.push([`mouth:${k}`, f]);
    if (manifest.eyes?.half) entries.push(["eyes:half", manifest.eyes.half]);
    if (manifest.eyes?.closed) entries.push(["eyes:closed", manifest.eyes.closed]);
    for (const [k, f] of Object.entries(manifest.emotions ?? {})) entries.push([`emotion:${k}`, f]);
    const loaded = await Promise.all(
      entries.map(async ([key, file]) => {
        try {
          return [key, toImageData(await loadImage(resolve(file)))] as const;
        } catch (e) {
          warnings.push((e as Error).message);
          return [key, undefined] as const;
        }
      }),
    );
    const baseData = loaded.find(([k]) => k === "base")?.[1];
    if (!baseData) throw new Error("image de base de la marionnette introuvable");
    p.width = baseData.width;
    p.height = baseData.height;
    for (const [key, data] of loaded) {
      if (!data) continue;
      if (data.width !== p.width || data.height !== p.height) {
        warnings.push(`${key} : ${data.width}×${data.height} au lieu de ${p.width}×${p.height}, ignorée`);
        continue;
      }
      p.images.set(key, data);
    }
    // zones : différence avec la base
    const bd = baseData.data;
    let mouthRect: Rect | null = manifest.regions?.mouth ?? null;
    let eyesRect: Rect | null = manifest.regions?.eyes ?? null;
    if (!mouthRect) {
      for (const [k, d] of p.images) if (k.startsWith("mouth:")) mouthRect = unionRect(mouthRect, diffRect(bd, d.data, p.width, p.height));
      if (!mouthRect) {
        mouthRect = { x: Math.round(p.width * 0.35), y: Math.round(p.height * 0.55), w: Math.round(p.width * 0.3), h: Math.round(p.height * 0.18) };
        warnings.push("zone de la bouche non détectée (images identiques à la base ?) : zone par défaut");
      }
    }
    if (!eyesRect) {
      for (const [k, d] of p.images) if (k.startsWith("eyes:") || k.startsWith("emotion:")) eyesRect = unionRect(eyesRect, diffRect(bd, d.data, p.width, p.height, mouthRect));
      if (!eyesRect) {
        eyesRect = { x: Math.round(p.width * 0.25), y: Math.round(p.height * 0.3), w: Math.round(p.width * 0.5), h: Math.round(p.height * 0.2) };
        warnings.push("zone des yeux non détectée : zone par défaut");
      }
    }
    // la zone des yeux ne doit pas mordre sur la bouche
    if (eyesRect.y + eyesRect.h > mouthRect.y) eyesRect.h = Math.max(10, mouthRect.y - eyesRect.y - 2);
    p.regions = { mouth: mouthRect, eyes: eyesRect };

    // fond transparent
    if (manifest.keyColor !== null && manifest.keyColor !== undefined) {
      const key = manifest.keyColor === "auto" ? cornerColor(bd, p.width, p.height) : hexToRgb(manifest.keyColor);
      const tol = manifest.keyTolerance ?? 0.12;
      for (const d of p.images.values()) keyOut(d, key, tol);
    }
    p.rebuild(cfg.feather);
    p.report = {
      kind: "marionnette",
      model: manifestUrl,
      placeholder: false,
      meshesWithMorphs: 0,
      blendshapesFound: [],
      blendshapesMissing: [],
      unknownMorphs: [],
      bonesFound: {},
      bonesMissing: [],
      animations: [],
      gestureSource: "procedural",
      clipsResolved: [],
      clipsMissing: [],
      renderer: "Canvas 2D (marionnette)",
      software: false,
      warnings,
      modelHeight: p.height,
      marionnette: {
        mouths: [...p.mouths.keys()],
        eyes: Object.keys(p.eyes),
        emotions: [...p.emotions.keys()],
        regions: p.regions,
        size: [p.width, p.height],
      },
    };
    return p;
  }

  /** (Re)construit les calques découpés avec l'adoucissement demandé. */
  rebuild(feather: number): void {
    if (feather === this.feather && this.base) return;
    this.feather = feather;
    const baseData = this.images.get("base")!;
    this.base = document.createElement("canvas");
    this.base.width = this.width;
    this.base.height = this.height;
    this.base.getContext("2d")!.putImageData(baseData, 0, 0);
    const mouthRect = padRect(this.regions.mouth, Math.round(feather), this.width, this.height);
    const eyesRect = padRect(this.regions.eyes, Math.round(feather), this.width, this.height);
    this.mouths.clear();
    this.emotions.clear();
    this.eyes = {};
    for (const [k, d] of this.images) {
      if (k.startsWith("mouth:")) this.mouths.set(k.slice(6), makeLayer(d, mouthRect, feather));
      else if (k === "eyes:half") this.eyes.half = makeLayer(d, eyesRect, feather);
      else if (k === "eyes:closed") this.eyes.closed = makeLayer(d, eyesRect, feather);
      else if (k.startsWith("emotion:")) this.emotions.set(k.slice(8), makeLayer(d, eyesRect, feather));
    }
  }

  /** Dessine l'image t dans un contexte 2D carré de diamètre `d`. */
  render(ctx: CanvasRenderingContext2D, d: number, frame: FrameState, cfg: MarionnetteConfig, energy: EnergyTrack | undefined): void {
    ctx.clearRect(0, 0, d, d);
    const scale = (d / Math.max(this.width, this.height)) * cfg.zoom;
    const head = frame.bones.head ?? [0, 0, 0];
    const breath = frame.bones.spine1?.[0] ?? 0; // degrés, <= 0
    const s = scale * (1 + cfg.breathing * Math.min(1, -breath / 0.8));
    ctx.save();
    ctx.translate(d / 2 + cfg.offsetX * d + head[1] * cfg.motion * scale, d / 2 + cfg.offsetY * d + head[0] * cfg.motion * 0.6 * scale);
    ctx.rotate((head[2] * 0.4 * Math.PI) / 180);
    ctx.scale(s, s);
    ctx.translate(-this.width / 2, -this.height / 2);
    ctx.drawImage(this.base, 0, 0);

    // bouche : fondu entre formes
    const e = energyAt(frame.t, energy);
    const stretch = 1 + cfg.mouthEnergy * (e - 0.5) * 2 * frame.speaking;
    for (const [shape, w] of Object.entries(frame.shapes)) {
      if (shape === "X" || w <= 0.002) continue;
      const layer = this.mouths.get(shape) ?? this.mouths.get(FALLBACK[shape] ?? "");
      if (!layer) continue;
      ctx.globalAlpha = Math.min(1, w);
      const r = layer.rect;
      const cy = r.y + r.h / 2;
      ctx.drawImage(layer.canvas, r.x, cy - (r.h / 2) * stretch, r.w, r.h * stretch);
    }
    // yeux : émotions puis clignement
    let emoTotal = 0;
    for (const [name, w] of Object.entries(frame.emotions)) {
      const layer = this.emotions.get(name);
      if (!layer || w <= 0.002) continue;
      const a = Math.min(1 - emoTotal, w);
      emoTotal += a;
      ctx.globalAlpha = a;
      ctx.drawImage(layer.canvas, layer.rect.x, layer.rect.y);
    }
    const blink = frame.blink;
    if (blink > 0.01) {
      if (this.eyes.half && this.eyes.closed) {
        const closed = smoothstep((blink - 0.45) / 0.3);
        const half = smoothstep((blink - 0.15) / 0.25) * (1 - closed);
        if (half > 0.01) {
          ctx.globalAlpha = half;
          ctx.drawImage(this.eyes.half.canvas, this.eyes.half.rect.x, this.eyes.half.rect.y);
        }
        if (closed > 0.01) {
          ctx.globalAlpha = closed;
          ctx.drawImage(this.eyes.closed.canvas, this.eyes.closed.rect.x, this.eyes.closed.rect.y);
        }
      } else {
        const layer = this.eyes.closed ?? this.eyes.half;
        if (layer) {
          ctx.globalAlpha = smoothstep((blink - 0.35) / 0.3);
          ctx.drawImage(layer.canvas, layer.rect.x, layer.rect.y);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

/** Formes de repli quand une bouche manque. */
const FALLBACK: Record<string, string> = { G: "A", H: "C", B: "C", E: "D", F: "E" };

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** Scène 2D de la marionnette : un canvas dans la bulle, mêmes réglages de page que la scène 3D. */
export class PuppetStage {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  diameter = 0;
  cfg: SceneConfig;

  constructor(cfg: SceneConfig, background: "green" | "transparent") {
    this.cfg = cfg;
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d")!;
    const bubble = document.getElementById("bubble")!;
    bubble.insertBefore(this.canvas, document.getElementById("ring"));
    this.applyConfig(cfg, background);
  }

  applyConfig(cfg: SceneConfig, background: "green" | "transparent"): void {
    this.cfg = cfg;
    this.diameter = layoutBubble(cfg, background);
    if (this.canvas.width !== this.diameter) {
      this.canvas.width = this.diameter;
      this.canvas.height = this.diameter;
    }
  }

  render(puppet: Puppet, frame: FrameState, energy: EnergyTrack | undefined): void {
    puppet.render(this.ctx, this.diameter, frame, this.cfg.marionnette, energy);
  }

  dispose(): void {
    this.canvas.remove();
  }
}
