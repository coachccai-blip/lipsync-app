/**
 * Conversion RGBA → I420 (Y'CbCr 4:2:0, BT.709, plage limitée 16-235 / 16-240), pour
 * l'export vidéo dans le navigateur.
 *
 * Laisser le navigateur convertir le canvas produit une vidéo en plage complète (0-255,
 * « yuvj420p »), que beaucoup de lecteurs et de logiciels de montage lisent comme une plage
 * limitée : les noirs sont écrasés, et dans les zones sombres les pixels proches du seuil
 * basculent d'une image à l'autre entre noir pur et gris foncé (grésillement de pixels noirs).
 * La conversion ici est la même sur toutes les machines et signale la bonne plage.
 *
 * La chrominance est la moyenne de chaque bloc 2×2 (moins de franges colorées sur les
 * contours fins que le simple sous-échantillonnage).
 */
export interface I420Frame {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Tables Y, Cb, Cr (BT.709 limité) par composante, calculées une fois. */
let tables: { yr: Float32Array; yg: Float32Array; yb: Float32Array; ur: Float32Array; ug: Float32Array; ub: Float32Array; vr: Float32Array; vg: Float32Array; vb: Float32Array } | undefined;

function buildTables() {
  const mk = (k: number) => {
    const t = new Float32Array(256);
    for (let i = 0; i < 256; i++) t[i] = i * k;
    return t;
  };
  // Y = 16 + 219 * (0.2126 R + 0.7152 G + 0.0722 B) ; Cb = 128 + 224 * (B − Y') / 1.8556 ; Cr = 128 + 224 * (R − Y') / 1.5748
  const s = 219 / 255;
  const c = 224 / 255;
  tables = {
    yr: mk(s * 0.2126),
    yg: mk(s * 0.7152),
    yb: mk(s * 0.0722),
    ur: mk((c * -0.2126) / 1.8556),
    ug: mk((c * -0.7152) / 1.8556),
    ub: mk((c * (1 - 0.0722)) / 1.8556),
    vr: mk((c * (1 - 0.2126)) / 1.5748),
    vg: mk((c * -0.7152) / 1.5748),
    vb: mk((c * -0.0722) / 1.5748),
  };
  return tables;
}

/** Convertit un tampon RGBA (largeur et hauteur paires) en I420 ; `out` est réutilisable. */
export function rgbaToI420(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, out?: Uint8Array): I420Frame {
  if (width % 2 || height % 2) throw new Error(`rgbaToI420 : dimensions paires requises (${width}×${height})`);
  const t = tables ?? buildTables();
  const ySize = width * height;
  const cw = width / 2;
  const ch = height / 2;
  const data = out && out.length === ySize + 2 * cw * ch ? out : new Uint8Array(ySize + 2 * cw * ch);
  const uOff = ySize;
  const vOff = ySize + cw * ch;
  for (let y = 0; y < height; y += 2) {
    const row0 = y * width;
    const row1 = row0 + width;
    const crow = (y / 2) * cw;
    for (let x = 0; x < width; x += 2) {
      let cb = 0;
      let cr = 0;
      for (const p of [row0 + x, row0 + x + 1, row1 + x, row1 + x + 1]) {
        const i = p * 4;
        const r = rgba[i];
        const g = rgba[i + 1];
        const b = rgba[i + 2];
        data[p] = 16 + t.yr[r] + t.yg[g] + t.yb[b] + 0.5;
        cb += t.ur[r] + t.ug[g] + t.ub[b];
        cr += t.vr[r] + t.vg[g] + t.vb[b];
      }
      const ci = crow + x / 2;
      data[uOff + ci] = 128 + cb / 4 + 0.5;
      data[vOff + ci] = 128 + cr / 4 + 0.5;
    }
  }
  return { data, width, height };
}
