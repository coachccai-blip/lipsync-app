import type { Performance, RhubarbShape, VisemeCue } from "./types.js";

/**
 * Performance synthétique : animation de test du jalon 2 (rotation de tête + jawOpen
 * sinusoïdal) plus une séquence de visèmes factice. Sert au rendu de test, à la page
 * de démonstration et aux tests de déterminisme.
 */
export function makeTestPerformance(duration = 4, fps = 30, seed = 12345, withVisemes = false): Performance {
  const visemes: VisemeCue[] = [];
  if (withVisemes) {
    const cycle: RhubarbShape[] = ["X", "D", "B", "C", "A", "E", "F", "X", "G", "H"];
    let t = 0.5;
    let i = 0;
    while (t < duration - 0.5) {
      const d = 0.12 + 0.06 * (i % 3);
      visemes.push({ start: t, end: t + d, shape: cycle[i % cycle.length] });
      t += d;
      i++;
    }
  }
  const n = Math.ceil(duration * fps);
  const energy = Array.from({ length: n }, (_, i) => 0.5 + 0.4 * Math.sin((i / fps) * 3));
  return {
    version: 1,
    fps,
    duration,
    audio: "audio.wav",
    text: "Animation de test",
    words: [],
    visemes,
    energy: { rate: fps, values: energy },
    accents: [1.0, 2.5],
    expressions: withVisemes ? [{ start: 0.5, end: duration - 0.5, emotion: "enjoué", intensity: 0.7, source: "test" }] : [],
    gestures: withVisemes ? [{ at: 0.8, clip: "salut", source: "test" }] : [],
    seed,
    ...(withVisemes ? {} : { test: true }),
  } as Performance;
}
