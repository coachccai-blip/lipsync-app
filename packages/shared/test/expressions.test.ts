import { describe, expect, it } from "vitest";
import { expressionWeightsAt } from "../src/anim/expressions.js";
import { DEFAULT_EMOTIONS } from "../src/defaults.js";
import type { ExpressionSegment } from "../src/types.js";

const segs: ExpressionSegment[] = [
  { start: 0, end: 2, emotion: "enjoué", intensity: 1, source: "test" },
  { start: 2, end: 4, emotion: "sérieux", intensity: 0.5, source: "test" },
];

describe("couche expressions", () => {
  it("applique la pose à pleine intensité au plateau", () => {
    const w = expressionWeightsAt(1, segs, DEFAULT_EMOTIONS);
    expect(w.mouthSmileLeft).toBeCloseTo(0.55, 5);
  });

  it("fond entre deux émotions sur fadeMs", () => {
    const w = expressionWeightsAt(2, segs, DEFAULT_EMOTIONS);
    expect(w.mouthSmileLeft).toBeCloseTo(0.55 * 0.5, 5);
    expect(w.browDownLeft).toBeCloseTo(0.35 * 0.5 * 0.5, 5);
  });

  it("atténue la zone bouche pendant la parole mais pas les sourcils", () => {
    const silent = expressionWeightsAt(1, segs, DEFAULT_EMOTIONS, 0);
    const speaking = expressionWeightsAt(1, segs, DEFAULT_EMOTIONS, 1);
    expect(speaking.mouthSmileLeft).toBeCloseTo(silent.mouthSmileLeft * DEFAULT_EMOTIONS.speechAttenuation, 5);
    expect(speaking.browInnerUp).toBeCloseTo(silent.browInnerUp, 5);
  });

  it("revient à zéro hors segment et ignore une émotion inconnue", () => {
    expect(expressionWeightsAt(10, segs, DEFAULT_EMOTIONS)).toEqual({});
    expect(expressionWeightsAt(1, [{ start: 0, end: 2, emotion: "inconnue", intensity: 1, source: "test" }], DEFAULT_EMOTIONS)).toEqual({});
  });
});
