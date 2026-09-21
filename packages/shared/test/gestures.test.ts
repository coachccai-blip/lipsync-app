import { describe, expect, it } from "vitest";
import { ProceduralGestureSource, proceduralPoseAt } from "../src/anim/gestures.js";
import { DEFAULT_GESTURES } from "../src/defaults.js";

describe("gestes procéduraux", () => {
  it("interpole les images clés", () => {
    const g = { duration: 1, keyframes: [{ t: 0, bones: {} }, { t: 1, bones: { head: [10, 0, 0] as [number, number, number] } }] };
    expect(proceduralPoseAt(0, g).head).toEqual([0, 0, 0]);
    expect(proceduralPoseAt(0.5, g).head[0]).toBeCloseTo(5, 5);
    expect(proceduralPoseAt(1, g).head[0]).toBeCloseTo(10, 5);
  });

  it("déclenche un geste à son instant et revient au repos ensuite", () => {
    const src = new ProceduralGestureSource([{ at: 1, clip: "acquiescement", source: "test" }], { ...DEFAULT_GESTURES, idle: { swayAmplitude: 0, swayPeriod: 5 } });
    expect(src.bonesAt(0.5)).toEqual({});
    expect(Math.abs(src.bonesAt(1.2).head![0])).toBeGreaterThan(1);
    expect(src.bonesAt(3)).toEqual({});
  });

  it("liste les gestes disponibles", () => {
    const src = new ProceduralGestureSource([], DEFAULT_GESTURES);
    expect(src.available()).toContain("salut");
  });
});
