import { describe, expect, it } from "vitest";
import { gestureWeightAt, questionTiltAt } from "../src/anim/compose.js";

describe("inclinaison sur les questions", () => {
  const words = [
    { w: "Bonjour", start: 0.2, end: 0.6 },
    { w: "ça", start: 0.7, end: 0.9 },
    { w: "va ?", start: 0.9, end: 1.2 },
    { w: "Oui.", start: 2, end: 2.4 },
    { w: "vraiment ?", start: 3, end: 3.5 },
  ];
  it("incline autour du mot interrogatif, signe alterné, rien ailleurs", () => {
    expect(questionTiltAt(0.0, words, 2.5)).toBe(0);
    expect(questionTiltAt(1.1, words, 2.5)).toBeCloseTo(2.5, 5);
    expect(questionTiltAt(2.2, words, 2.5)).toBe(0);
    expect(questionTiltAt(3.4, words, 2.5)).toBeCloseTo(-2.5, 5);
    expect(questionTiltAt(1.1, words, 0)).toBe(0);
  });
});

describe("geste actif avec fondu", () => {
  const events = [{ at: 1, clip: "salut" }, { at: 4, clip: "index" }];
  it("monte puis descend sur la durée du geste", () => {
    expect(gestureWeightAt(0.5, events, { salut: 1.8 }, 300)).toBeUndefined();
    expect(gestureWeightAt(1.15, events, { salut: 1.8 }, 300)?.weight).toBeCloseTo(0.5, 5);
    expect(gestureWeightAt(2, events, { salut: 1.8 }, 300)).toEqual({ clip: "salut", weight: 1 });
    expect(gestureWeightAt(2.7, events, { salut: 1.8 }, 300)?.weight).toBeCloseTo(1 / 3, 5);
    expect(gestureWeightAt(4.5, events, { salut: 1.8 }, 300)?.clip).toBe("index");
  });
});
