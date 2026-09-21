import { describe, expect, it } from "vitest";
import { PerformanceValidationError, validatePerformance } from "../src/performance.js";
import { makeTestPerformance } from "../src/demo.js";
import { createAnimator } from "../src/anim/compose.js";
import { DEFAULT_CONFIG } from "../src/defaults.js";

describe("validation de performance.json", () => {
  it("accepte une performance de test", () => {
    const p = validatePerformance(JSON.parse(JSON.stringify(makeTestPerformance(3, 30, 1, true))));
    expect(p.fps).toBe(30);
  });

  it("signale les erreurs avec leur chemin", () => {
    const bad = { ...makeTestPerformance(2), fps: "30", visemes: [{ start: 0, end: 1, shape: "Z" }] };
    try {
      validatePerformance(bad);
      throw new Error("aurait dû échouer");
    } catch (e) {
      expect(e).toBeInstanceOf(PerformanceValidationError);
      const msg = (e as Error).message;
      expect(msg).toContain("fps");
      expect(msg).toContain("visemes[0].shape");
    }
  });

  it("vérifie les vocabulaires d'émotions et de gestes si fournis", () => {
    const p = makeTestPerformance(3, 30, 1, true);
    expect(() => validatePerformance(p, { knownEmotions: ["neutre"] })).toThrow(/enjoué/);
  });
});

describe("animateur", () => {
  it("est déterministe : mêmes entrées, mêmes poids", () => {
    const perf = makeTestPerformance(4, 30, 99, true);
    const a = createAnimator(perf, DEFAULT_CONFIG);
    const b = createAnimator(perf, DEFAULT_CONFIG);
    for (let i = 0; i < 120; i++) {
      expect(a.frameAt(i / 30)).toEqual(b.frameAt(i / 30));
    }
  });

  it("ne dépend pas de l'ordre d'appel", () => {
    const perf = makeTestPerformance(4, 30, 7, true);
    const a = createAnimator(perf, DEFAULT_CONFIG);
    const late = a.frameAt(2.5);
    a.frameAt(0.1);
    a.frameAt(3.9);
    expect(a.frameAt(2.5)).toEqual(late);
  });

  it("garde tous les poids entre 0 et 1", () => {
    const perf = makeTestPerformance(4, 30, 3, true);
    const a = createAnimator(perf, DEFAULT_CONFIG);
    for (let i = 0; i < 120; i++) {
      const f = a.frameAt(i / 30);
      for (const v of Object.values(f.morphs)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
