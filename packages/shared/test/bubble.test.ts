import { describe, expect, it } from "vitest";
import { bubbleBackground, bubbleCornerRadius, bubbleParallax, gradientFromColor, hexToRgb, hslToRgb, rgbToHex, rgbToHsl, traceBubblePath } from "../src/bubble.js";

describe("fond de bulle", () => {
  it("convertit hex ↔ hsl sans perte notable", () => {
    for (const c of ["#f3d9b1", "#1e2a4a", "#4a5568", "#ffffff", "#000000", "#00ff00"]) {
      const rgb = hexToRgb(c)!;
      expect(rgbToHex(hslToRgb(rgbToHsl(rgb)))).toBe(c);
    }
  });

  it("calcule un dégradé radial avec halo plus clair et bord plus sombre", () => {
    const css = gradientFromColor("#f3d9b1");
    const m = /^radial-gradient\(circle at 50% 35%, (#[0-9a-f]{6}) 0%, (#[0-9a-f]{6}) 60%, (#[0-9a-f]{6}) 100%\)$/.exec(css);
    expect(m).not.toBeNull();
    const l = (hex: string) => rgbToHsl(hexToRgb(hex)!)[2];
    expect(l(m![1])).toBeGreaterThan(l(m![2]));
    expect(l(m![3])).toBeLessThan(l(m![2]));
    expect(m![2]).toBe("#f3d9b1");
  });

  it("reste lisible pour une teinte sombre", () => {
    const m = /(#[0-9a-f]{6}) 0%, (#[0-9a-f]{6}) 60%, (#[0-9a-f]{6}) 100%/.exec(gradientFromColor("#1e2a4a"))!;
    const l = (hex: string) => rgbToHsl(hexToRgb(hex)!)[2];
    expect(l(m[1]) - l(m[2])).toBeGreaterThan(0.2);
    expect(l(m[3])).toBeGreaterThanOrEqual(0.04);
  });

  it("respecte le CSS libre et retombe sur le dégradé sinon", () => {
    expect(bubbleBackground({ background: "#123456", couleur: "#f3d9b1", fondLibre: true })).toBe("#123456");
    expect(bubbleBackground({ background: "#123456" })).toBe("#123456");
    expect(bubbleBackground({ background: "#123456", couleur: "#f3d9b1" })).toContain("radial-gradient");
  });
});

describe("forme de la bulle", () => {
  it("cercle par défaut, carré arrondi borné au demi-côté", () => {
    expect(bubbleCornerRadius({}, 1000)).toBe(500);
    expect(bubbleCornerRadius({ shape: "carre", cornerRadius: 96 }, 1000)).toBe(96);
    expect(bubbleCornerRadius({ shape: "carre", cornerRadius: 900 }, 1000)).toBe(500);
    expect(bubbleCornerRadius({ shape: "carre" }, 1000)).toBe(0);
  });

  it("trace un cercle ou un carré arrondi réduit de l'épaisseur d'anneau", () => {
    const calls: string[] = [];
    const ctx = {
      beginPath: () => calls.push("begin"),
      arc: (x: number, y: number, r: number) => calls.push(`arc ${x},${y},${r}`),
      moveTo: (x: number, y: number) => calls.push(`move ${x},${y}`),
      arcTo: (x1: number, y1: number, x2: number, y2: number, r: number) => calls.push(`arcTo ${x1},${y1},${x2},${y2},${r}`),
      closePath: () => calls.push("close"),
    };
    traceBubblePath(ctx, { shape: "cercle" }, 540, 540, 1000, 7);
    expect(calls).toEqual(["begin", "arc 540,540,493"]);
    calls.length = 0;
    traceBubblePath(ctx, { shape: "carre", cornerRadius: 100 }, 540, 540, 1000, 10);
    expect(calls[0]).toBe("begin");
    expect(calls[1]).toBe("move 140,50");
    expect(calls[2]).toBe("arcTo 1030,50,1030,1030,90");
    expect(calls.at(-1)).toBe("close");
  });
});

describe("parallaxe", () => {
  it("glisse à l'inverse de la tête, nul si désactivée", () => {
    const p = bubbleParallax([2, -4, 1], 3);
    expect(p.dx).toBeCloseTo(12, 6);
    expect(p.dy).toBeCloseTo(-3.6, 6);
    expect(bubbleParallax([2, -4, 1], 0)).toEqual({ dx: 0, dy: 0 });
    expect(bubbleParallax(undefined, 3)).toEqual({ dx: 0, dy: 0 });
  });
});
