import { describe, expect, it } from "vitest";
import { blinkAt, buildLifeSchedule, lifeAt } from "../src/anim/life.js";
import { DEFAULT_SCENE } from "../src/defaults.js";

const cfg = DEFAULT_SCENE.life;

describe("vie procédurale", () => {
  it("planifie des clignements espacés dans l'intervalle configuré", () => {
    const s = buildLifeSchedule(123, 60, cfg);
    expect(s.blinks.length).toBeGreaterThan(8);
    for (let i = 1; i < s.blinks.length; i++) {
      const gap = s.blinks[i] - s.blinks[i - 1];
      expect(gap).toBeGreaterThan(0.2);
      expect(gap).toBeLessThanOrEqual(cfg.blink.maxInterval + 0.01);
    }
  });

  it("est identique pour une même seed et différent sinon", () => {
    expect(buildLifeSchedule(1, 30, cfg)).toEqual(buildLifeSchedule(1, 30, cfg));
    expect(buildLifeSchedule(1, 30, cfg).blinks).not.toEqual(buildLifeSchedule(2, 30, cfg).blinks);
  });

  it("ferme puis rouvre l'œil pendant un clignement", () => {
    expect(blinkAt(0.9, [1], 0.2)).toBe(0);
    expect(blinkAt(1.08, [1], 0.2)).toBe(1);
    expect(blinkAt(1.3, [1], 0.2)).toBe(0);
  });

  it("hausse les sourcils sur un accent", () => {
    const s = buildLifeSchedule(9, 10, cfg);
    const on = lifeAt(2.17, s, cfg, [2.0]);
    const off = lifeAt(5, s, cfg, [2.0]);
    expect(on.morphs.browInnerUp ?? 0).toBeGreaterThan(0.1);
    expect(off.morphs.browInnerUp ?? 0).toBe(0);
    expect(on.bones.head).toBeDefined();
  });
});
