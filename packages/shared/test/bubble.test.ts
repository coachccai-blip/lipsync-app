import { describe, expect, it } from "vitest";
import { bubbleBackground, gradientFromColor, hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from "../src/bubble.js";

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
