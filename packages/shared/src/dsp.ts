import type { EnergyTrack, RhubarbShape, VisemeCue } from "./types.js";

/** FFT radix-2 en place (re, im), longueur puissance de deux. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

// ---------------------------------------------------------------- énergie

export interface EnergyAnalysis {
  energy: EnergyTrack;
  accents: number[];
}

export interface EnergyOptions {
  /** Fenêtre RMS en secondes. */
  windowSec?: number;
  /** Cadence de sortie (échantillons/s), normalement = fps. */
  rate: number;
  /** Seuil de détection des accents (0..1 après normalisation). */
  accentThreshold?: number;
  /** Écart minimal entre deux accents (s). */
  accentMinGap?: number;
}

/** Enveloppe RMS par fenêtres de 20 ms. */
export function rmsEnvelope(samples: Float32Array, sampleRate: number, windowSec = 0.02): { values: number[]; rate: number } {
  const win = Math.max(1, Math.round(sampleRate * windowSec));
  const n = Math.ceil(samples.length / win);
  const values = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    const start = i * win;
    const end = Math.min(samples.length, start + win);
    for (let j = start; j < end; j++) acc += samples[j] * samples[j];
    values[i] = Math.sqrt(acc / Math.max(1, end - start));
  }
  return { values, rate: 1 / windowSec };
}

/** Rééchantillonne une courbe (interpolation linéaire). */
export function resample(values: number[], fromRate: number, toRate: number, duration: number): number[] {
  const n = Math.ceil(duration * toRate);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const pos = (i / toRate) * fromRate;
    const j = Math.floor(pos);
    const a = values[Math.min(j, values.length - 1)] ?? 0;
    const b = values[Math.min(j + 1, values.length - 1)] ?? a;
    out[i] = a + (b - a) * (pos - j);
  }
  return out;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/**
 * Analyse d'énergie : courbe normalisée 0..1 à la cadence vidéo, et instants d'accent
 * (pics locaux de l'enveloppe au-dessus d'un seuil, espacés d'au moins accentMinGap).
 */
export function analyzeEnergy(samples: Float32Array, sampleRate: number, options: EnergyOptions): EnergyAnalysis {
  const windowSec = options.windowSec ?? 0.02;
  const threshold = options.accentThreshold ?? 0.6;
  const minGap = options.accentMinGap ?? 0.35;
  const duration = samples.length / sampleRate;
  const env = rmsEnvelope(samples, sampleRate, windowSec);
  const smoothed = env.values.map((_, i, arr) => {
    const a = arr[Math.max(0, i - 1)];
    const c = arr[Math.min(arr.length - 1, i + 1)];
    return (a + arr[i] + c) / 3;
  });
  const ref = percentile(smoothed, 0.95) || 1;
  const norm = smoothed.map((v) => Math.min(1, v / ref));
  const accents: number[] = [];
  let last = -Infinity;
  for (let i = 1; i < norm.length - 1; i++) {
    const t = (i + 0.5) * windowSec;
    if (norm[i] >= threshold && norm[i] >= norm[i - 1] && norm[i] > norm[i + 1] && t - last >= minGap) {
      const back = Math.max(0, i - Math.round(0.3 / windowSec));
      let avg = 0;
      for (let j = back; j < i; j++) avg += norm[j];
      avg /= Math.max(1, i - back);
      if (norm[i] > avg * 1.25) {
        accents.push(Math.round(t * 1000) / 1000);
        last = t;
      }
    }
  }
  const values = resample(norm, env.rate, options.rate, duration).map((v) => Math.round(v * 1000) / 1000);
  return { energy: { rate: options.rate, values }, accents };
}

// ---------------------------------------------------------------- lip sync approximatif

export interface ApproxLipsyncOptions {
  /** Pas d'analyse en secondes (défaut 0,03). */
  hopSec?: number;
  /** Durée minimale d'une forme (s). */
  minCue?: number;
}

/**
 * Lip sync approximatif sans reconnaisseur phonétique : à chaque pas, l'énergie décide
 * de l'ouverture (X, B, C, D) et le centre spectral de l'arrondi (E, F pour les sons
 * graves et fermés, C et D pour les sons ouverts). Moins précis que Rhubarb, mais
 * disponible partout (navigateur, Node sans outil externe) et sur toute la durée.
 */
export function approximateLipsync(samples: Float32Array, sampleRate: number, options: ApproxLipsyncOptions = {}): VisemeCue[] {
  const hop = Math.max(64, Math.round(sampleRate * (options.hopSec ?? 0.03)));
  const minCue = options.minCue ?? 0.06;
  const N = 1024;
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const frames = Math.max(1, Math.ceil(samples.length / hop));
  const energy = new Float32Array(frames);
  const centroid = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    let acc = 0;
    for (let i = 0; i < N; i++) {
      const v = samples[off + i] ?? 0;
      re[i] = v * win[i];
      im[i] = 0;
      acc += v * v;
    }
    energy[f] = Math.sqrt(acc / N);
    fft(re, im);
    let num = 0;
    let den = 0;
    for (let k = 1; k < N / 2; k++) {
      const m = re[k] * re[k] + im[k] * im[k];
      const hz = (k * sampleRate) / N;
      if (hz > 5000) break;
      num += m * hz;
      den += m;
    }
    centroid[f] = den > 0 ? num / den : 0;
  }
  // normalisation de l'énergie par le 95e centile
  const sorted = Array.from(energy).sort((a, b) => a - b);
  const ref = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const cues: VisemeCue[] = [];
  let currentShape: RhubarbShape = "X";
  let currentStart = 0;
  for (let f = 0; f < frames; f++) {
    const e = Math.min(1, energy[f] / ref);
    const c = centroid[f];
    let shape: RhubarbShape;
    if (e < 0.08) shape = "X";
    else if (e < 0.22) shape = c > 2200 ? "B" : "A";
    else if (c < 900) shape = e > 0.55 ? "E" : "F";
    else if (c < 1700) shape = e > 0.6 ? "D" : "C";
    else if (c < 2800) shape = e > 0.7 ? "C" : "B";
    else shape = "B";
    if (shape !== currentShape) {
      const t = (f * hop) / sampleRate;
      if (t - currentStart >= minCue || cues.length === 0) {
        if (t > currentStart) cues.push({ start: round(currentStart), end: round(t), shape: currentShape });
        currentShape = shape;
        currentStart = t;
      }
    }
  }
  const end = samples.length / sampleRate;
  if (end > currentStart) cues.push({ start: round(currentStart), end: round(end), shape: currentShape });
  // fusion des voisins identiques
  const merged: VisemeCue[] = [];
  for (const c of cues) {
    const last = merged[merged.length - 1];
    if (last && last.shape === c.shape) last.end = c.end;
    else merged.push({ ...c });
  }
  return merged;
}

const round = (v: number) => Math.round(v * 1000) / 1000;
