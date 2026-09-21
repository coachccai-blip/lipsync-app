import type { EnergyTrack } from "@avatar/shared";

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

  // lissage léger (3 fenêtres) puis normalisation par le 95e centile
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
      // vrai pic : nettement au-dessus du niveau des 300 ms précédentes
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
