/**
 * Analyse audio côté navigateur pour la timeline : forme d'onde (crêtes par tranche de 2 ms)
 * et spectrogramme (STFT, fenêtre de Hann, échelle de fréquence logarithmique).
 */
export interface AudioAnalysis {
  duration: number;
  sampleRate: number;
  /** Crêtes min/max par tranche de `bucketSec`. */
  peaks: { min: Float32Array; max: Float32Array; bucketSec: number };
  /** Image du spectrogramme : une colonne par trame, une ligne par bande (graves en bas). */
  spectrogram: { canvas: HTMLCanvasElement; frames: number; hopSec: number };
}

const BUCKET_SEC = 0.002;
const FFT_SIZE = 1024;
const HOP = 512;
const BANDS = 96;
const F_MIN = 60;
const F_MAX = 8000;

export async function analyzeAudio(url: string): Promise<AudioAnalysis> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`audio introuvable : ${url}`);
  const buf = await res.arrayBuffer();
  const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const decoded = await ctx.decodeAudioData(buf);
  void ctx.close();
  const sr = decoded.sampleRate;
  const n = decoded.length;
  const mono = new Float32Array(n);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const d = decoded.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / decoded.numberOfChannels;
  }
  // crêtes
  const bucket = Math.max(1, Math.round(sr * BUCKET_SEC));
  const nb = Math.ceil(n / bucket);
  const min = new Float32Array(nb);
  const max = new Float32Array(nb);
  for (let b = 0; b < nb; b++) {
    let lo = 0;
    let hi = 0;
    const end = Math.min(n, (b + 1) * bucket);
    for (let i = b * bucket; i < end; i++) {
      const v = mono[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { duration: decoded.duration, sampleRate: sr, peaks: { min, max, bucketSec: bucket / sr }, spectrogram: spectrogram(mono, sr) };
}

/** FFT radix-2 en place (re, im). */
function fft(re: Float32Array, im: Float32Array): void {
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

function spectrogram(mono: Float32Array, sr: number): AudioAnalysis["spectrogram"] {
  const frames = Math.max(1, Math.floor((mono.length - FFT_SIZE) / HOP) + 1);
  const canvas = document.createElement("canvas");
  canvas.width = frames;
  canvas.height = BANDS;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(frames, BANDS);
  const data = img.data;
  const window = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  // bandes log entre F_MIN et F_MAX
  const binOf = (f: number) => Math.min(FFT_SIZE / 2 - 1, Math.max(0, Math.round((f / sr) * FFT_SIZE)));
  const edges: number[] = [];
  for (let b = 0; b <= BANDS; b++) edges.push(binOf(F_MIN * Math.pow(F_MAX / F_MIN, b / BANDS)));
  const mags = new Float32Array(BANDS);
  let globalMax = 1e-6;
  const all = new Float32Array(frames * BANDS);
  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = (mono[off + i] ?? 0) * window[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < BANDS; b++) {
      const b0 = edges[b];
      const b1 = Math.max(b0 + 1, edges[b + 1]);
      let acc = 0;
      for (let k = b0; k < b1; k++) acc += re[k] * re[k] + im[k] * im[k];
      const m = Math.sqrt(acc / (b1 - b0));
      mags[b] = m;
      if (m > globalMax) globalMax = m;
    }
    all.set(mags, f * BANDS);
  }
  // échelle dB sur 60 dB
  for (let f = 0; f < frames; f++) {
    for (let b = 0; b < BANDS; b++) {
      const m = all[f * BANDS + b];
      const db = 20 * Math.log10(m / globalMax + 1e-9);
      const v = Math.max(0, Math.min(1, (db + 60) / 60));
      const [r, g, bl] = colormap(v);
      const y = BANDS - 1 - b;
      const i = (y * frames + f) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = bl;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, frames, hopSec: HOP / sr };
}

/** Palette sombre → violet → orange → blanc (type magma). */
function colormap(v: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [8, 8, 20],
    [60, 20, 90],
    [150, 40, 110],
    [230, 90, 60],
    [252, 180, 60],
    [252, 250, 200],
  ];
  const p = v * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(p));
  const k = p - i;
  return [0, 1, 2].map((c) => Math.round(stops[i][c] + (stops[i + 1][c] - stops[i][c]) * k)) as [number, number, number];
}

/** Dessine la forme d'onde entre t0 et t1 dans le rectangle donné. */
export function drawWave(ctx: CanvasRenderingContext2D, a: AudioAnalysis, x0: number, w: number, t0: number, t1: number, y: number, h: number, color: string): void {
  const mid = y + h / 2;
  const amp = h / 2 - 2;
  ctx.fillStyle = color;
  const { min, max, bucketSec } = a.peaks;
  for (let px = 0; px < w; px++) {
    const ta = t0 + ((t1 - t0) * px) / w;
    const tb = t0 + ((t1 - t0) * (px + 1)) / w;
    const b0 = Math.floor(ta / bucketSec);
    const b1 = Math.max(b0 + 1, Math.floor(tb / bucketSec));
    if (b0 >= min.length) break;
    let lo = 0;
    let hi = 0;
    for (let b = b0; b < Math.min(b1, min.length); b++) {
      if (min[b] < lo) lo = min[b];
      if (max[b] > hi) hi = max[b];
    }
    const top = mid - hi * amp;
    const bottom = mid - lo * amp;
    ctx.fillRect(x0 + px, top, 1, Math.max(1, bottom - top));
  }
}

/** Dessine le spectrogramme entre t0 et t1 dans le rectangle donné. */
export function drawSpectrogram(ctx: CanvasRenderingContext2D, a: AudioAnalysis, x0: number, w: number, t0: number, t1: number, y: number, h: number): void {
  const { canvas, frames, hopSec } = a.spectrogram;
  const f0 = Math.max(0, t0 / hopSec);
  const f1 = Math.min(frames, t1 / hopSec);
  if (f1 <= f0) return;
  const visibleW = ((f1 - f0) / ((t1 - t0) / hopSec)) * w;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, f0, 0, f1 - f0, canvas.height, x0, y, visibleW, h);
}
