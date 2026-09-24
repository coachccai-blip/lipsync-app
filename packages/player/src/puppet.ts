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
  /** Regard : pupilles déplacées (left / right = côté de l'image, up). */
  gaze?: { left?: string; right?: string; up?: string; down?: string };
  /** Sourcils seuls : levés (accents, questions) et froncés (insistance). */
  brows?: { up?: string; down?: string };
  /** Bouches souriantes, mêmes clés Rhubarb, utilisées pendant les émotions listées dans smileEmotions. */
  mouthsSmile?: Record<string, string>;
  smileEmotions?: string[];
  /** Mains : clé = nom de geste de la piste gestes (salut, explication, index, approbation…). */
  hands?: Record<string, string>;
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
export function keyOut(img: ImageData, key: [number, number, number], tolerance: number, loose?: { alpha: Uint8ClampedArray; tolerance: number }): void {
  const d = img.data;
  const t0 = tolerance * 0.5 * 255;
  const t1 = tolerance * 1.5 * 255;
  const l0 = (loose?.tolerance ?? tolerance) * 0.5 * 255;
  const l1 = (loose?.tolerance ?? tolerance) * 1.5 * 255;
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.max(Math.abs(d[i] - key[0]), Math.abs(d[i + 1] - key[1]), Math.abs(d[i + 2] - key[2]));
    // là où la base est déjà du fond, on détoure plus largement (fond légèrement différent d'une image à l'autre)
    const isBg = loose ? loose.alpha[i + 3] < 128 : false;
    const a = isBg ? smoothstep((dist - l0) / (l1 - l0)) : smoothstep((dist - t0) / (t1 - t0));
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

/** Flou boîte séparable (deux passes = quasi gaussien) sur un champ scalaire. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r <= 0) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / n;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Dilatation (filtre max) séparable. */
function dilate(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r <= 0) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.max(m, src[y * w + k]);
      tmp[y * w + x] = m;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.max(m, tmp[k * w + x]);
      out[y * w + x] = m;
    }
  }
  return out;
}

/**
 * Noyau de « vrai changement » entre une image et la base dans un rectangle : 1 là où la
 * différence (lissée) dépasse le seuil, 0 ailleurs (le grain propre à chaque image reste sous
 * le seuil).
 */
export function changeCore(img: Uint8ClampedArray, base: Uint8ClampedArray, width: number, rect: Rect, gate: number): Float32Array {
  const { w, h } = rect;
  const mag = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((rect.y + y) * width + rect.x + x) * 4;
      mag[y * w + x] = Math.max(Math.abs(img[i] - base[i]), Math.abs(img[i + 1] - base[i + 1]), Math.abs(img[i + 2] - base[i + 2]));
    }
  }
  const core = boxBlur(mag, w, h, 2);
  for (let i = 0; i < core.length; i++) core[i] = core[i] >= gate ? 1 : 0;
  return core;
}

/** Masque final à partir d'un noyau : dilaté de quelques pixels puis adouci. */
export function softenCore(core: Float32Array, w: number, h: number): Float32Array {
  // dilatation large puis fondu long : une différence de teinte entre deux images ne dessine
  // jamais de bord visible, et le contour anti-aliasé du vrai changement reste opaque
  return boxBlur(boxBlur(dilate(core, w, h, 12), w, h, 8), w, h, 8);
}

/** Masque de vrai changement d'une seule image (noyau adouci). */
export function changeMask(img: Uint8ClampedArray, base: Uint8ClampedArray, width: number, rect: Rect, gate: number): Float32Array {
  return softenCore(changeCore(img, base, width, rect, gate), rect.w, rect.h);
}

/**
 * Masque commun à un groupe d'images (toutes les bouches, ou tous les yeux) : union des
 * noyaux, pour que chaque calque recouvre aussi ce que les autres images changent (la bouche
 * au repos de la base doit disparaître sous n'importe quelle bouche ouverte).
 */
export function groupMask(images: Uint8ClampedArray[], base: Uint8ClampedArray, width: number, rect: Rect, gate: number): Float32Array {
  const union = new Float32Array(rect.w * rect.h);
  for (const img of images) {
    const core = changeCore(img, base, width, rect, gate);
    for (let i = 0; i < union.length; i++) if (core[i] > 0) union[i] = 1;
  }
  return softenCore(union, rect.w, rect.h);
}

/**
 * Découpe une zone d'une image en calque aux bords adoucis. Avec un masque de changement,
 * seule la zone réellement modifiée reste opaque (le grain de l'image est ignoré).
 */
function makeLayer(img: ImageData, rect: Rect, feather: number, change?: Float32Array, smoothing = 0): Layer {
  const c = document.createElement("canvas");
  c.width = rect.w;
  c.height = rect.h;
  const ctx = c.getContext("2d")!;
  const src = document.createElement("canvas");
  src.width = img.width;
  src.height = img.height;
  src.getContext("2d")!.putImageData(img, 0, 0);
  if (smoothing > 0) ctx.filter = `blur(${smoothing}px)`;
  ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  ctx.filter = "none";
  if (feather > 0 || change) {
    const mask = ctx.createImageData(rect.w, rect.h);
    const m = mask.data;
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) {
        const dEdge = Math.min(x + 1, y + 1, rect.w - x, rect.h - y);
        const edge = feather > 0 ? smoothstep(Math.min(1, dEdge / feather)) : 1;
        const k = y * rect.w + x;
        m[k * 4 + 3] = Math.round(255 * edge * (change ? Math.min(1, change[k]) : 1));
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

function clipRect(r: Rect, within: Rect): Rect {
  const x = Math.max(r.x, within.x);
  const y = Math.max(r.y, within.y);
  const x2 = Math.min(r.x + r.w, within.x + within.w);
  const y2 = Math.min(r.y + r.h, within.y + within.h);
  return { x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) };
}

/** Met à zéro un masque dans des rectangles (avec un fondu de 24 px autour). */
export function excludeRects(mask: Float32Array, rect: Rect, exclusions: Rect[]): Float32Array {
  const out = new Float32Array(mask);
  const fade = 24;
  for (const ex of exclusions) {
    const x0 = Math.max(rect.x, ex.x - fade);
    const y0 = Math.max(rect.y, ex.y - fade);
    const x1 = Math.min(rect.x + rect.w, ex.x + ex.w + fade);
    const y1 = Math.min(rect.y + rect.h, ex.y + ex.h + fade);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const dEdge = Math.min(x - (ex.x - fade), y - (ex.y - fade), ex.x + ex.w + fade - 1 - x, ex.y + ex.h + fade - 1 - y);
        const keep = dEdge >= fade ? 0 : 1 - smoothstep(Math.max(0, dEdge) / fade);
        const k = (y - rect.y) * rect.w + (x - rect.x);
        out[k] *= keep;
      }
    }
  }
  return out;
}

/** Copie d'un canvas avec une alpha verticale : 1 sur [y0, y1], fondu jusqu'à 0 à y0 - f et y1 + f. */
function verticalBand(src: HTMLCanvasElement, y0: number, y1: number, f: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, src.height);
  const stop = (y: number) => Math.min(1, Math.max(0, y / src.height));
  g.addColorStop(0, y0 - f <= 0 ? "rgba(0,0,0,1)" : "rgba(0,0,0,0)");
  if (y0 - f > 0) g.addColorStop(stop(y0 - f), "rgba(0,0,0,0)");
  g.addColorStop(stop(y0), "rgba(0,0,0,1)");
  g.addColorStop(stop(y1), "rgba(0,0,0,1)");
  if (y1 + f < src.height) g.addColorStop(stop(y1 + f), "rgba(0,0,0,0)");
  g.addColorStop(1, y1 + f >= src.height ? "rgba(0,0,0,1)" : "rgba(0,0,0,0)");
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, src.width, src.height);
  ctx.globalCompositeOperation = "source-over";
  return c;
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
  mouthsSmile = new Map<string, Layer>();
  smileEmotions = new Set<string>(["enjoué"]);
  eyes: { half?: Layer; closed?: Layer } = {};
  emotions = new Map<string, Layer>();
  gaze = new Map<string, Layer>();
  brows = new Map<string, Layer>();
  hands = new Map<string, Layer>();
  regions!: { mouth: Rect; eyes: Rect; eyesOnly?: Rect; brows?: Rect };
  /** Bandes du personnage pour le suivi retardé (construites par rebuild). */
  private bands?: { torso: HTMLCanvasElement; head: HTMLCanvasElement; hair: HTMLCanvasElement; neckY: number; hairY: number };
  private shadow?: HTMLCanvasElement;
  private keyed = false;
  report!: LoadReport;
  private images = new Map<string, ImageData>();
  private feather = 0;
  private buildKey = "";

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
    for (const [k, f] of Object.entries(manifest.gaze ?? {})) if (f) entries.push([`gaze:${k}`, f]);
    for (const [k, f] of Object.entries(manifest.brows ?? {})) if (f) entries.push([`brow:${k}`, f]);
    for (const [k, f] of Object.entries(manifest.mouthsSmile ?? {})) entries.push([`smile:${k}`, f]);
    for (const [k, f] of Object.entries(manifest.hands ?? {})) entries.push([`hand:${k}`, f]);
    if (manifest.smileEmotions) p.smileEmotions = new Set(manifest.smileEmotions);
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
      for (const [k, d] of p.images) if (k.startsWith("mouth:") || k.startsWith("smile:")) mouthRect = unionRect(mouthRect, diffRect(bd, d.data, p.width, p.height));
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
    // yeux seuls (paupières et pupilles, sans sourcils) : d'après les images de clignement
    let eyesOnly: Rect | null = null;
    for (const [k, d] of p.images) if (k.startsWith("eyes:")) eyesOnly = unionRect(eyesOnly, diffRect(bd, d.data, p.width, p.height, mouthRect));
    if (eyesOnly) eyesOnly = clipRect(eyesOnly, eyesRect);
    // sourcils : au-dessus des yeux seuls, d'après les images de sourcils et d'émotions
    let browsRect: Rect | null = null;
    if (eyesOnly) {
      for (const [k, d] of p.images) if (k.startsWith("brow:") || k.startsWith("emotion:")) browsRect = unionRect(browsRect, diffRect(bd, d.data, p.width, p.height, mouthRect));
      if (browsRect) {
        const bottom = eyesOnly.y - 2; // strictement au-dessus des yeux : ces images changent parfois aussi les yeux
        browsRect = { x: browsRect.x, y: browsRect.y, w: browsRect.w, h: Math.max(0, bottom - browsRect.y) };
        if (browsRect.h < 8) browsRect = null;
      }
    }
    p.regions = { mouth: mouthRect, eyes: eyesRect, eyesOnly: eyesOnly ?? undefined, brows: browsRect ?? undefined };

    // fond transparent
    if (manifest.keyColor !== null && manifest.keyColor !== undefined) {
      // en mode auto, chaque image est détourée sur SA couleur de coins : les images générées
      // n'ont pas toutes exactement le même fond
      const tol = manifest.keyTolerance ?? 0.12;
      const keyFor = (d: ImageData) => (manifest.keyColor === "auto" ? cornerColor(d.data, p.width, p.height) : hexToRgb(manifest.keyColor as string));
      keyOut(baseData, keyFor(baseData), tol);
      for (const [k, d] of p.images) {
        if (k === "base") continue;
        keyOut(d, keyFor(d), tol, { alpha: baseData.data, tolerance: Math.max(tol, 0.26) });
      }
      p.keyed = true;
    }
    p.rebuild(cfg.feather, cfg.seuilBruit ?? 0, cfg.lissage ?? 0);
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
        gaze: [...p.gaze.keys()],
        brows: [...p.brows.keys()],
        smiles: [...p.mouthsSmile.keys()],
        hands: [...p.hands.keys()],
        regions: p.regions,
        size: [p.width, p.height],
      },
    };
    return p;
  }

  /** (Re)construit les calques découpés : adoucissement des bords, seuil de bruit, lissage du grain. */
  rebuild(feather: number, gate = 0, smoothing = 0): void {
    const key = `${feather}|${gate}|${smoothing}`;
    if (key === this.buildKey && this.base) return;
    this.buildKey = key;
    this.feather = feather;
    const baseData = this.images.get("base")!;
    this.base = document.createElement("canvas");
    this.base.width = this.width;
    this.base.height = this.height;
    if (smoothing > 0) {
      const raw = document.createElement("canvas");
      raw.width = this.width;
      raw.height = this.height;
      raw.getContext("2d")!.putImageData(baseData, 0, 0);
      const bctx = this.base.getContext("2d")!;
      bctx.filter = `blur(${smoothing}px)`;
      bctx.drawImage(raw, 0, 0);
      bctx.filter = "none";
    } else this.base.getContext("2d")!.putImageData(baseData, 0, 0);
    const mouthRect = padRect(this.regions.mouth, Math.round(feather), this.width, this.height);
    const eyesRect = padRect(this.regions.eyes, Math.round(feather), this.width, this.height);
    this.mouths.clear();
    this.emotions.clear();
    this.eyes = {};
    this.mouthsSmile.clear();
    this.gaze.clear();
    this.brows.clear();
    this.hands.clear();
    const entries = [...this.images].filter(([k]) => k !== "base");
    const pick = (prefix: string) => entries.filter(([k]) => k.startsWith(prefix)).map(([, d]) => d.data);
    const mouthImages = [...pick("mouth:"), ...pick("smile:")];
    const eyeImages = [...pick("eyes:"), ...pick("emotion:")];
    const mouthMask = gate > 0 ? groupMask(mouthImages, baseData.data, this.width, mouthRect, gate) : undefined;
    const eyesMask = gate > 0 ? groupMask(eyeImages, baseData.data, this.width, eyesRect, gate) : undefined;
    // regard : zone des yeux seuls (les images de regard changent parfois aussi sourcils ou bouche, ignorés)
    const eyesOnly = this.regions.eyesOnly ? padRect(this.regions.eyesOnly, Math.round(feather), this.width, this.height) : undefined;
    const gazeMask = eyesOnly && gate > 0 ? groupMask([...pick("gaze:"), ...pick("eyes:")], baseData.data, this.width, eyesOnly, gate) : undefined;
    // sourcils seuls : bande au-dessus des yeux
    const browsRect = this.regions.brows ? padRect(this.regions.brows, Math.round(feather), this.width, this.height) : undefined;
    const browsMask = browsRect && gate > 0 ? groupMask([...pick("brow:"), ...pick("emotion:")], baseData.data, this.width, browsRect, gate) : undefined;
    // mains : tout le cadre, sauf le visage (yeux, sourcils, bouche) que ces images modifient parfois aussi
    const full: Rect = { x: 0, y: 0, w: this.width, h: this.height };
    const faceExclusion = [mouthRect, eyesRect, browsRect].filter((r): r is Rect => Boolean(r)).map((r) => padRect(r, 40, this.width, this.height));
    for (const [k, d] of entries) {
      if (k.startsWith("mouth:")) this.mouths.set(k.slice(6), makeLayer(d, mouthRect, feather, mouthMask, smoothing));
      else if (k.startsWith("smile:")) this.mouthsSmile.set(k.slice(6), makeLayer(d, mouthRect, feather, mouthMask, smoothing));
      else if (k === "eyes:half") this.eyes.half = makeLayer(d, eyesRect, feather, eyesMask, smoothing);
      else if (k === "eyes:closed") this.eyes.closed = makeLayer(d, eyesRect, feather, eyesMask, smoothing);
      else if (k.startsWith("emotion:")) this.emotions.set(k.slice(8), makeLayer(d, eyesRect, feather, eyesMask, smoothing));
      else if (k.startsWith("gaze:") && eyesOnly) this.gaze.set(k.slice(5), makeLayer(d, eyesOnly, feather, gazeMask, smoothing));
      else if (k.startsWith("brow:") && browsRect) this.brows.set(k.slice(5), makeLayer(d, browsRect, feather, browsMask, smoothing));
      else if (k.startsWith("hand:")) {
        let mask = changeMask(d.data, baseData.data, this.width, full, Math.max(12, gate));
        mask = excludeRects(mask, full, faceExclusion);
        this.hands.set(k.slice(5), makeLayer(d, full, 0, mask, smoothing));
      }
    }
    this.buildBands(mouthRect, browsRect ?? eyesRect);
    this.buildShadow();
  }

  /** Bandes buste / tête / cheveux pour le suivi retardé. */
  private buildBands(mouthRect: Rect, browsRect: Rect): void {
    const neckY = Math.min(this.height - 1, mouthRect.y + mouthRect.h + Math.round(this.height * 0.06));
    const hairY = Math.max(1, browsRect.y - Math.round(this.height * 0.02));
    const f = Math.round(this.height * 0.06);
    this.bands = {
      torso: verticalBand(this.base, neckY + Math.round(f * 0.5), this.height, f),
      head: verticalBand(this.base, 0, neckY + Math.round(f * 0.5), f),
      hair: verticalBand(this.base, 0, hairY, f),
      neckY,
      hairY,
    };
  }

  /** Silhouette floue du personnage (ombre de contact), seulement si le fond a été détouré. */
  private buildShadow(): void {
    this.shadow = undefined;
    if (!this.keyed) return;
    const c = document.createElement("canvas");
    c.width = this.width;
    c.height = this.height;
    const ctx = c.getContext("2d")!;
    ctx.filter = `blur(${Math.round(this.width * 0.02)}px)`;
    ctx.drawImage(this.base, 0, 0);
    ctx.filter = "none";
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = "source-over";
    this.shadow = c;
  }

  /** Dessine l'image t dans un contexte 2D carré de diamètre `d`. */
  render(ctx: CanvasRenderingContext2D, d: number, frame: FrameState, cfg: MarionnetteConfig, energy: EnergyTrack | undefined): void {
    ctx.clearRect(0, 0, d, d);
    const scale = (d / Math.max(this.width, this.height)) * cfg.zoom;
    const head = frame.bones.head ?? [0, 0, 0];
    const breath = frame.bones.spine1?.[0] ?? 0; // degrés, <= 0
    const s = scale * (1 + cfg.breathing * Math.min(1, -breath / 0.8));
    const suivi = Math.max(0, Math.min(1, cfg.suivi ?? 0));
    const tx = head[1] * cfg.motion * scale;
    const ty = head[0] * cfg.motion * 0.6 * scale;
    const rot = (head[2] * 0.4 * Math.PI) / 180;
    const cx = d / 2 + cfg.offsetX * d;
    const cy = d / 2 + cfg.offsetY * d;
    // transformations : buste (mouvement réduit), tête (complet), cheveux (tête + retard)
    const lag = frame.headLag ?? [0, 0, 0];
    const lagX = -lag[1] * cfg.motion * scale * 1.6 * suivi;
    const lagY = -lag[0] * cfg.motion * 0.6 * scale * 1.6 * suivi;
    const torsoK = 1 - 0.6 * suivi;
    const withTransform = (dx: number, dy: number, r: number, fn: () => void) => {
      ctx.save();
      ctx.translate(cx + dx, cy + dy);
      ctx.rotate(r);
      ctx.scale(s, s);
      ctx.translate(-this.width / 2, -this.height / 2);
      fn();
      ctx.restore();
    };
    const drawHead = (fn: () => void) => withTransform(tx, ty, rot, fn);
    const drawTorso = (fn: () => void) => withTransform(tx * torsoK, ty * torsoK, rot * torsoK, fn);

    // ombre de contact
    const ombre = cfg.ombre ?? 0;
    if (this.shadow && ombre > 0) {
      ctx.globalAlpha = ombre;
      withTransform(tx * torsoK, ty * torsoK + d * 0.012, rot * torsoK, () => ctx.drawImage(this.shadow!, 0, 0));
      ctx.globalAlpha = 1;
    }

    // corps
    if (this.bands && suivi > 0) {
      drawTorso(() => ctx.drawImage(this.bands!.torso, 0, 0));
      drawHead(() => ctx.drawImage(this.bands!.head, 0, 0));
      withTransform(tx + lagX, ty + lagY, rot, () => ctx.drawImage(this.bands!.hair, 0, 0));
    } else drawHead(() => ctx.drawImage(this.base, 0, 0));

    // mains : piste gestes, fondu d'entrée / sortie, sous les calques du visage
    const gesture = frame.gesture;
    if (cfg.mains !== false && gesture && gesture.weight > 0.01) {
      const layer = this.hands.get(gesture.clip) ?? this.hands.get(HAND_ALIASES[gesture.clip] ?? "");
      if (layer) {
        ctx.globalAlpha = gesture.weight;
        drawTorso(() => ctx.drawImage(layer.canvas, layer.rect.x, layer.rect.y));
        ctx.globalAlpha = 1;
      }
    }

    drawHead(() => {
      // bouche : transition courte entre formes, rendue plus franche par une courbe de contraste
      const e = energyAt(frame.t, energy);
      const stretch = 1 + cfg.mouthEnergy * (e - 0.5) * 2 * frame.speaking;
      const sharp = Math.max(1, cfg.mouthSharpness ?? 2);
      const smiling = frame.emotionDisplayed !== undefined && this.smileEmotions.has(frame.emotionDisplayed) && this.mouthsSmile.size > 0;
      const mouthLayer = (shape: string): Layer | undefined => (smiling ? this.mouthsSmile.get(shape) : undefined) ?? this.mouths.get(shape) ?? this.mouths.get(FALLBACK[shape] ?? "");
      const active = Object.entries(frame.shapes).filter(([shape, w]) => shape !== "X" && w > 0.002);
      let total = 0;
      const weights = active.map(([shape, w]) => {
        const ws = Math.pow(w, sharp);
        total += ws;
        return [shape, ws] as const;
      });
      const rest = Math.max(0, 1 - active.reduce((acc, [, w]) => acc + w, 0));
      const restSharp = Math.pow(rest, sharp);
      const norm = total + restSharp > 0 ? 1 / (total + restSharp) : 1;
      // composition « over » en ordre croissant : chaque forme finit avec la couverture voulue
      let covered = restSharp * norm;
      // bouche au repos souriante pendant une émotion souriante
      const restLayer = smiling ? this.mouthsSmile.get("X") : undefined;
      if (restLayer && restSharp * norm > 0.01) {
        ctx.globalAlpha = 1;
        ctx.drawImage(restLayer.canvas, restLayer.rect.x, restLayer.rect.y);
      }
      for (const [shape, ws] of [...weights].sort((a, b) => a[1] - b[1])) {
        const layer = mouthLayer(shape);
        const target = ws * norm;
        covered += target;
        if (!layer || target < 0.01) continue;
        ctx.globalAlpha = Math.min(1, target / covered);
        const r = layer.rect;
        const my = r.y + r.h / 2;
        ctx.drawImage(layer.canvas, r.x, my - (r.h / 2) * stretch, r.w, r.h * stretch);
      }
      ctx.globalAlpha = 1;
      // yeux : une seule image d'émotion, changée pendant un clignement (jamais mélangée)
      const emotionLayer = frame.emotionDisplayed ? this.emotions.get(frame.emotionDisplayed) : undefined;
      if (emotionLayer) ctx.drawImage(emotionLayer.canvas, emotionLayer.rect.x, emotionLayer.rect.y);
      // regard : pupilles déplacées, seulement sur les yeux de base (une émotion garde ses propres yeux)
      const blink = frame.blink;
      if (cfg.regard !== false && !emotionLayer && frame.gaze && blink < 0.3) {
        const g = frame.gaze;
        let key: string | undefined;
        if (g.y > 0.28 && this.gaze.has("up")) key = "up";
        else if (g.y < -0.28 && this.gaze.has("down")) key = "down";
        else if (g.x > 0.22 && this.gaze.has("right")) key = "right";
        else if (g.x < -0.22 && this.gaze.has("left")) key = "left";
        const layer = key ? this.gaze.get(key) : undefined;
        if (layer) ctx.drawImage(layer.canvas, layer.rect.x, layer.rect.y);
      }
      // sourcils sur les accents : levés (ou froncés pendant une émotion sérieuse)
      const browThreshold = cfg.sourcilsAccent ?? 0.55;
      if ((frame.brow ?? 0) >= browThreshold && browThreshold < 1) {
        const key = frame.emotionDisplayed === "sérieux" && this.brows.has("down") ? "down" : "up";
        const layer = this.brows.get(key);
        if (layer) ctx.drawImage(layer.canvas, layer.rect.x, layer.rect.y);
      }
      // clignement par paliers nets : ouvert, mi-clos, fermé
      const closedLayer = this.eyes.closed ?? this.eyes.half;
      const halfLayer = this.eyes.half;
      if (blink >= 0.7 && closedLayer) ctx.drawImage(closedLayer.canvas, closedLayer.rect.x, closedLayer.rect.y);
      else if (blink >= 0.3 && halfLayer) ctx.drawImage(halfLayer.canvas, halfLayer.rect.x, halfLayer.rect.y);
      else if (blink >= 0.5 && closedLayer) ctx.drawImage(closedLayer.canvas, closedLayer.rect.x, closedLayer.rect.y);
      ctx.globalAlpha = 1;
    });
  }
}

/** Formes de repli quand une bouche manque. */
const FALLBACK: Record<string, string> = { G: "A", H: "C", B: "C", E: "D", F: "E" };

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** Noms de gestes de la piste → clé d'image de main du manifeste. */
const HAND_ALIASES: Record<string, string> = {
  mains_ouvertes: "explication",
  explication: "explication",
  salut: "salut",
  index: "index",
  approbation: "approbation",
  pouce: "approbation",
};

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
    this.ctx.imageSmoothingQuality = "high";
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
      this.ctx.imageSmoothingQuality = "high"; // le redimensionnement réinitialise le contexte
    }
  }

  render(puppet: Puppet, frame: FrameState, energy: EnergyTrack | undefined): void {
    puppet.render(this.ctx, this.diameter, frame, this.cfg.marionnette, energy);
  }

  dispose(): void {
    this.canvas.remove();
  }
}
