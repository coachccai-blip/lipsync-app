export const clamp = (v: number, min = 0, max = 1): number => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Courbe d'adoucissement 0..1 -> 0..1 (dérivée nulle aux bornes). */
export const smoothstep = (x: number): number => {
  const t = clamp(x);
  return t * t * (3 - 2 * t);
};

export const easeInOutSine = (x: number): number => -(Math.cos(Math.PI * clamp(x)) - 1) / 2;
export const easeOutCubic = (x: number): number => 1 - Math.pow(1 - clamp(x), 3);

/**
 * Enveloppe trapézoïdale adoucie : 0 avant `start`, monte sur `fade`, 1 au plateau,
 * redescend sur `fade` autour de `end`. Les fondus sont centrés sur les bornes.
 */
export function envelope(t: number, start: number, end: number, fade: number): number {
  if (fade <= 0) return t >= start && t < end ? 1 : 0;
  const half = fade / 2;
  const rise = smoothstep((t - (start - half)) / fade);
  const fall = 1 - smoothstep((t - (end - half)) / fade);
  return clamp(Math.min(rise, fall));
}

/** Bruit lisse déterministe : somme de sinusoïdes à phases fixées. */
export function smoothNoise(t: number, phases: number[], speed: number): number {
  let v = 0;
  let norm = 0;
  for (let i = 0; i < phases.length; i++) {
    const f = speed * (0.37 + 0.61 * i);
    const a = 1 / (i + 1);
    v += a * Math.sin(2 * Math.PI * f * t + phases[i]);
    norm += a;
  }
  return v / norm;
}

export function addWeights(target: Record<string, number>, source: Record<string, number>, factor = 1): void {
  for (const k in source) {
    target[k] = (target[k] ?? 0) + source[k] * factor;
  }
}

export function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
