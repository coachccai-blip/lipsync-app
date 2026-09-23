import { describe, expect, it } from "vitest";
import { parseCssBackground } from "../src/ui/export.js";
import { bubbleGeometry } from "../src/bubble.js";
import { DEFAULT_SCENE } from "@avatar/shared";

function fakeCtx() {
  const calls: { kind: string; args: number[]; stops: [number, string][] }[] = [];
  const make = (kind: string, args: number[]) => {
    const g = { kind, args, stops: [] as [number, string][], addColorStop(p: number, c: string) { this.stops.push([p, c]); } };
    calls.push(g);
    return g as unknown as CanvasGradient;
  };
  return {
    calls,
    ctx: {
      createLinearGradient: (...a: number[]) => make("linear", a),
      createRadialGradient: (...a: number[]) => make("radial", a),
    } as unknown as CanvasRenderingContext2D,
  };
}

describe("parseCssBackground", () => {
  it("renvoie une couleur simple telle quelle", () => {
    const { ctx } = fakeCtx();
    expect(parseCssBackground("#123456", ctx, 0, 0, 10, 10)).toBe("#123456");
  });

  it("convertit un dégradé linéaire avec angle et arrêts en pourcentage", () => {
    const { ctx, calls } = fakeCtx();
    parseCssBackground("linear-gradient(180deg, #fff 0%, rgba(0,0,0,0.5) 100%)", ctx, 0, 0, 100, 100);
    expect(calls[0].kind).toBe("linear");
    // 180deg : du haut vers le bas, centré
    expect(calls[0].args.map((v) => Math.round(v) + 0)).toEqual([50, 0, 50, 100]);
    expect(calls[0].stops).toEqual([[0, "#fff"], [1, "rgba(0,0,0,0.5)"]]);
  });

  it("gère radial-gradient avec position", () => {
    const { ctx, calls } = fakeCtx();
    parseCssBackground("radial-gradient(circle at 50% 30%, #ffffff, #e0d0c0)", ctx, 10, 10, 100, 100);
    expect(calls[0].kind).toBe("radial");
    expect(calls[0].args.slice(0, 2)).toEqual([60, 40]);
    expect(calls[0].stops).toEqual([[0, "#ffffff"], [1, "#e0d0c0"]]);
  });
});

describe("bubbleGeometry", () => {
  it("centre la bulle et respecte la marge en mode auto", () => {
    const g = bubbleGeometry({ ...DEFAULT_SCENE, resolution: { width: 1920, height: 1080 }, bubble: { ...DEFAULT_SCENE.bubble, diameter: "auto", margin: 40 } });
    expect(g).toEqual({ d: 1000, cx: 960, cy: 540 });
  });
});
