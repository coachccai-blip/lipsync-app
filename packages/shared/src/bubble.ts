/** Fond de la bulle : dégradé généré à partir d'une couleur, pour mettre l'avatar en valeur. */

export interface BubbleBackgroundConfig {
  background: string;
  couleur?: string;
  fondLibre?: boolean;
}

/** Palette proposée dans le studio (teinte de base ; le dégradé est calculé). */
export const BUBBLE_PALETTE: { label: string; color: string }[] = [
  { label: "Crème", color: "#f3d9b1" },
  { label: "Pêche", color: "#f6c9b0" },
  { label: "Sable", color: "#e9dcc3" },
  { label: "Rose", color: "#f2c6d6" },
  { label: "Lavande", color: "#d5c9ee" },
  { label: "Ciel", color: "#bfd9f2" },
  { label: "Menthe", color: "#bfe3d2" },
  { label: "Citron", color: "#f0e6a8" },
  { label: "Gris perle", color: "#d9dde3" },
  { label: "Ardoise", color: "#4a5568" },
  { label: "Bleu nuit", color: "#1e2a4a" },
  { label: "Prune", color: "#4a2b4f" },
  { label: "Anthracite", color: "#2b2f36" },
];

export function hexToRgb(hex: string): [number, number, number] | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  let s = m[1];
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}

export function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

export function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/**
 * Dégradé radial « mettant en valeur » : un halo plus clair derrière la tête (centre haut),
 * la teinte choisie au milieu, un bord un peu plus sombre et plus saturé (vignettage doux).
 * Fonctionne pour les teintes claires comme sombres.
 */
export function gradientFromColor(color: string): string {
  const rgb = hexToRgb(color) ?? [243, 217, 177];
  const [h, s, l] = rgbToHsl(rgb);
  const lift = Math.min(0.25, (1 - l) * 0.6);
  const hi = rgbToHex(hslToRgb([h, s * 0.9, Math.min(0.98, l + lift)]));
  const edge = rgbToHex(hslToRgb([h, Math.min(1, s * 1.2), Math.max(0.04, l - 0.1)]));
  return `radial-gradient(circle at 50% 35%, ${hi} 0%, ${rgbToHex(rgb)} 60%, ${edge} 100%)`;
}

/** CSS du fond de bulle : dégradé calculé depuis `couleur`, sauf si le CSS libre est demandé. */
export function bubbleBackground(b: BubbleBackgroundConfig): string {
  if (b.fondLibre || !b.couleur) return b.background;
  return gradientFromColor(b.couleur);
}

/** Rayon CSS des coins de la bulle : cercle (50 %) ou carré arrondi (px), borné au demi-côté. */
export function bubbleCornerRadius(b: { shape?: "cercle" | "carre"; cornerRadius?: number }, side: number): number {
  if (b.shape !== "carre") return side / 2;
  return Math.max(0, Math.min(side / 2, b.cornerRadius ?? 0));
}

/**
 * Trace le contour de la bulle (cercle ou carré arrondi) dans un contexte 2D, réduit de `inset`
 * pixels (pour l'anneau, tracé au milieu de son épaisseur).
 */
export function traceBubblePath(
  ctx: { beginPath(): void; arc(x: number, y: number, r: number, a0: number, a1: number): void; moveTo(x: number, y: number): void; arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void; closePath(): void },
  b: { shape?: "cercle" | "carre"; cornerRadius?: number },
  cx: number,
  cy: number,
  side: number,
  inset = 0,
): void {
  const s = side - 2 * inset;
  ctx.beginPath();
  if (b.shape !== "carre") {
    ctx.arc(cx, cy, s / 2, 0, Math.PI * 2);
    return;
  }
  const r = Math.max(0, Math.min(s / 2, bubbleCornerRadius(b, side) - inset));
  const x = cx - s / 2;
  const y = cy - s / 2;
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + s, y, x + s, y + s, r);
  ctx.arcTo(x + s, y + s, x, y + s, r);
  ctx.arcTo(x, y + s, x, y, r);
  ctx.arcTo(x, y, x + s, y, r);
  ctx.closePath();
}
