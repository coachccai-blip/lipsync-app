import { describe, expect, it } from "vitest";
import { mouthWeightsAt, shapeWeightsAt, speakingFactorAt } from "../src/anim/mouth.js";
import { DEFAULT_VISEMES } from "../src/defaults.js";
import type { VisemeCue } from "../src/types.js";

const cfg = { ...DEFAULT_VISEMES, anticipationMs: 0, transitionMs: 100, exaggeration: 1, energyInfluence: 0 };
const cues: VisemeCue[] = [
  { start: 0, end: 1, shape: "X" },
  { start: 1, end: 2, shape: "D" },
  { start: 2, end: 3, shape: "F" },
  { start: 3, end: 4, shape: "X" },
];

describe("couche bouche", () => {
  it("est au repos sur X", () => {
    expect(mouthWeightsAt(0.5, cues, undefined, cfg)).toEqual({});
  });

  it("applique la pose de la forme au plateau", () => {
    const w = mouthWeightsAt(1.5, cues, undefined, cfg);
    expect(w.jawOpen).toBeCloseTo(0.65, 5);
  });

  it("interpole entre deux formes autour de la transition", () => {
    const s = shapeWeightsAt(2.0, cues, cfg);
    expect(s.D).toBeCloseTo(0.5, 5);
    expect(s.F).toBeCloseTo(0.5, 5);
    const w = mouthWeightsAt(2.0, cues, undefined, cfg);
    expect(w.jawOpen).toBeCloseTo((0.65 + 0.15) / 2, 5);
    expect(w.mouthPucker).toBeCloseTo(0.4, 5);
  });

  it("anticipe la forme de anticipationMs", () => {
    const early = mouthWeightsAt(0.95, cues, undefined, { ...cfg, anticipationMs: 50, transitionMs: 0 });
    expect(early.jawOpen).toBeCloseTo(0.65, 5);
    const late = mouthWeightsAt(0.95, cues, undefined, { ...cfg, transitionMs: 0 });
    expect(late.jawOpen).toBeUndefined();
  });

  it("module jawOpen par l'énergie et applique l'exagération", () => {
    const energy = { rate: 1, values: [1, 1, 1, 1, 1] };
    const w = mouthWeightsAt(1.5, cues, energy, { ...cfg, energyInfluence: 1 });
    expect(w.jawOpen).toBeCloseTo(0.65 * 1.5, 5);
    const ex = mouthWeightsAt(1.5, cues, undefined, { ...cfg, exaggeration: 1.2 });
    expect(ex.jawOpen).toBeCloseTo(0.78, 5);
    const capped = mouthWeightsAt(1.5, cues, energy, { ...cfg, energyInfluence: 1, exaggeration: 2 });
    expect(capped.jawOpen).toBe(1);
  });

  it("donne un facteur de parole nul au repos et plein en parole", () => {
    expect(speakingFactorAt(0.5, cues, cfg)).toBe(0);
    expect(speakingFactorAt(1.5, cues, cfg)).toBe(1);
  });
});
