import { describe, expect, it } from "vitest";
import { changeMask, consensusRect, diffRect, groupMask, keyOut, unionRect } from "../src/puppet.js";

function image(w: number, h: number, fill: [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = fill[0];
    d[i + 1] = fill[1];
    d[i + 2] = fill[2];
    d[i + 3] = 255;
  }
  return d;
}

function paint(d: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number, c: [number, number, number]): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * w + x) * 4;
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
  }
}

describe("marionnette 2D : détection des zones", () => {
  const W = 256;
  const H = 256;

  it("trouve la zone modifiée et ignore le bruit épars", () => {
    const base = image(W, H, [200, 150, 120]);
    const other = new Uint8ClampedArray(base);
    paint(other, W, 96, 160, 160, 200, [40, 10, 10]); // bouche
    // bruit : un pixel isolé tous les 40 px
    for (let y = 0; y < H; y += 40) for (let x = 0; x < W; x += 40) paint(other, W, x, y, x + 1, y + 1, [0, 0, 0]);
    const r = diffRect(base, other, W, H);
    expect(r).not.toBeNull();
    expect(r!.x).toBe(96);
    expect(r!.y).toBe(160);
    expect(r!.x + r!.w).toBe(160);
    expect(r!.y + r!.h).toBe(208);
  });

  it("exclut une zone donnée (la bouche quand on cherche les yeux)", () => {
    const base = image(W, H, [200, 150, 120]);
    const other = new Uint8ClampedArray(base);
    paint(other, W, 64, 64, 192, 96, [0, 0, 0]); // yeux
    paint(other, W, 96, 160, 160, 200, [0, 0, 0]); // bouche ouverte aussi
    const mouth = { x: 96, y: 160, w: 64, h: 48 };
    const eyes = diffRect(base, other, W, H, mouth)!;
    expect(eyes.y + eyes.h).toBeLessThanOrEqual(96);
    expect(diffRect(base, base, W, H)).toBeNull();
  });

  it("fusionne des rectangles", () => {
    expect(unionRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toEqual({ x: 0, y: 0, w: 15, h: 15 });
    expect(unionRect(null, { x: 1, y: 1, w: 1, h: 1 })).toEqual({ x: 1, y: 1, w: 1, h: 1 });
  });

  it("rend le fond transparent avec des bords adoucis", () => {
    const d = image(4, 1, [99, 179, 228]);
    paint(d, 4, 1, 0, 2, 1, [240, 200, 170]); // peau
    paint(d, 4, 2, 0, 3, 1, [110, 185, 225]); // presque fond
    const img = { data: d, width: 4, height: 1 } as unknown as ImageData;
    keyOut(img, [99, 179, 228], 0.12);
    expect(d[3]).toBe(0);
    expect(d[7]).toBe(255);
    expect(d[11]).toBeLessThan(80);
  });
});

describe("marionnette 2D : masque de vrai changement", () => {
  it("ignore le grain et garde la zone réellement modifiée, bords adoucis", () => {
    const W = 200;
    const H = 120;
    const base = image(W, H, [200, 150, 120]);
    const other = new Uint8ClampedArray(base);
    // grain : ±6 niveaux partout, motif déterministe
    for (let i = 0; i < other.length; i += 4) {
      const n = ((i / 4) % 7) - 3;
      other[i] += n;
      other[i + 1] -= n;
    }
    // vraie bouche : rectangle sombre
    paint(other, W, 80, 50, 120, 70, [60, 20, 20]);
    const rect = { x: 0, y: 0, w: W, h: H };
    const m = changeMask(other, base, W, rect, 20);
    expect(m[10 * W + 10]).toBe(0); // grain seul : rien
    expect(m[60 * W + 100]).toBeCloseTo(1, 5); // centre de la bouche : opaque
    // bord : opaque encore quelques pixels après le trait (dilatation), puis fondu vers 0
    expect(m[60 * W + 122]).toBeGreaterThan(0.93);
    expect(m[60 * W + 138]).toBeGreaterThan(0.05);
    expect(m[60 * W + 138]).toBeLessThan(0.9);
    expect(m[60 * W + 165]).toBe(0);
  });
});

describe("marionnette 2D : masque commun d'un groupe", () => {
  it("couvre l'union des zones changées par toutes les images", () => {
    const W = 200;
    const H = 120;
    const base = image(W, H, [200, 150, 120]);
    const a = new Uint8ClampedArray(base);
    paint(a, W, 20, 50, 50, 70, [60, 20, 20]);
    const b = new Uint8ClampedArray(base);
    paint(b, W, 150, 50, 180, 70, [60, 20, 20]);
    const m = groupMask([a, b], base, W, { x: 0, y: 0, w: W, h: H }, 20);
    expect(m[60 * W + 35]).toBeCloseTo(1, 5);
    expect(m[60 * W + 165]).toBeCloseTo(1, 5);
    expect(m[60 * W + 100]).toBe(0);
    expect(m[10 * W + 10]).toBe(0);
  });
});

describe("marionnette 2D : zone par consensus", () => {
  it("ignore une image qui a aussi modifié une autre zone", () => {
    const W = 256;
    const H = 256;
    const base = image(W, H, [200, 150, 120]);
    const mouths = [];
    for (let i = 0; i < 4; i++) {
      const m = new Uint8ClampedArray(base);
      paint(m, W, 96, 160, 160, 200, [60, 20, 20]);
      if (i === 0) paint(m, W, 64, 40, 192, 70, [20, 20, 20]); // sourcils retouchés par erreur
      mouths.push(m);
    }
    const r = consensusRect(base, mouths, W, H, 2)!;
    expect(r.y).toBeGreaterThanOrEqual(144);
    expect(r.y + r.h).toBeLessThanOrEqual(208);
    const r1 = consensusRect(base, mouths, W, H, 1)!;
    expect(r1.y).toBeLessThan(64);
  });
});
