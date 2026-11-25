import { describe, expect, it } from "vitest";
import { rgbaToI420 } from "../src/video.js";

function solid(w: number, h: number, rgb: [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) d.set([...rgb, 255], i);
  return d;
}

describe("export vidéo : conversion RGBA → I420 (BT.709, plage limitée)", () => {
  it("place le noir à Y=16 et le blanc à Y=235, chroma neutre à 128", () => {
    const black = rgbaToI420(solid(4, 2, [0, 0, 0]), 4, 2);
    expect(black.data[0]).toBe(16);
    expect(black.data[8]).toBe(128); // Cb
    expect(black.data[10]).toBe(128); // Cr
    const white = rgbaToI420(solid(4, 2, [255, 255, 255]), 4, 2);
    expect(white.data[0]).toBe(235);
    expect(white.data[8]).toBe(128);
    expect(white.data[10]).toBe(128);
    expect(white.data.length).toBe(4 * 2 + 2 * 2 * 1);
  });

  it("donne au rouge pur un Cr élevé et au bleu pur un Cb élevé, sans dépasser 240", () => {
    const red = rgbaToI420(solid(2, 2, [255, 0, 0]), 2, 2);
    expect(red.data[5]).toBe(240); // Cr
    expect(red.data[4]).toBeLessThan(128); // Cb
    expect(red.data[0]).toBe(63); // Y = 16 + 219 * 0.2126
    const blue = rgbaToI420(solid(2, 2, [0, 0, 255]), 2, 2);
    expect(blue.data[4]).toBe(240);
    expect(blue.data[5]).toBeLessThan(128);
  });

  it("moyenne la chrominance sur chaque bloc 2×2 et réutilise le tampon fourni", () => {
    const d = new Uint8ClampedArray(2 * 2 * 4);
    d.set([255, 0, 0, 255], 0); // rouge
    d.set([0, 0, 255, 255], 4); // bleu
    d.set([255, 0, 0, 255], 8);
    d.set([0, 0, 255, 255], 12);
    const out = new Uint8Array(6);
    const f = rgbaToI420(d, 2, 2, out);
    expect(f.data).toBe(out);
    // moyenne rouge + bleu : Cb et Cr tous deux au-dessus de 128 mais loin de 240
    expect(f.data[4]).toBeGreaterThan(128);
    expect(f.data[4]).toBeLessThan(200);
    expect(f.data[5]).toBeGreaterThan(128);
    expect(f.data[5]).toBeLessThan(200);
  });

  it("refuse les dimensions impaires", () => {
    expect(() => rgbaToI420(solid(3, 2, [0, 0, 0]), 3, 2)).toThrow();
  });
});
