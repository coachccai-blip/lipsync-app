import { Prng, type PostConfig } from "@avatar/shared";

const TILE = 256;

/**
 * Post-traitement dessiné sur un canvas posé au-dessus du personnage, dans la bulle :
 * vignettage doux des bords et grain fin. Le grain est déterministe : la graine dépend du
 * numéro d'image, donc la prévisualisation et le rendu hors ligne sont identiques.
 */
export class PostFX {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private tile?: HTMLCanvasElement;
  private size = 0;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "post";
    this.canvas.style.cssText = "position:absolute;inset:0;pointer-events:none;display:block";
    this.ctx = this.canvas.getContext("2d")!;
    const bubble = document.getElementById("bubble")!;
    bubble.insertBefore(this.canvas, document.getElementById("ring"));
  }

  private ensure(d: number): void {
    if (this.size === d) return;
    this.size = d;
    this.canvas.width = d;
    this.canvas.height = d;
  }

  private grainTile(): HTMLCanvasElement {
    if (this.tile) return this.tile;
    const c = document.createElement("canvas");
    c.width = TILE;
    c.height = TILE;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(TILE, TILE);
    const rng = new Prng(20240917);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.round(128 + (rng.next() - 0.5) * 255);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.tile = c;
    return c;
  }

  /** Dessine vignettage et grain pour l'image `frameIndex` sur un carré de côté `d`. */
  render(cfg: PostConfig | undefined, d: number, frameIndex: number): void {
    this.ensure(d);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, d, d);
    if (!cfg) return;
    if (cfg.vignette > 0) {
      const g = ctx.createRadialGradient(d / 2, d / 2, d * 0.42, d / 2, d / 2, d * 0.72);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${Math.min(1, cfg.vignette).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, d, d);
    }
    if (cfg.grain > 0) {
      const rng = new Prng(1000003 + frameIndex * 7919);
      const ox = Math.floor(rng.next() * TILE);
      const oy = Math.floor(rng.next() * TILE);
      ctx.globalAlpha = Math.min(0.5, cfg.grain);
      ctx.globalCompositeOperation = "overlay";
      const tile = this.grainTile();
      for (let y = -oy; y < d; y += TILE) for (let x = -ox; x < d; x += TILE) ctx.drawImage(tile, x, y);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }
  }

  dispose(): void {
    this.canvas.remove();
  }
}

let sharpenAmount = -1;

/** Filtre SVG de netteté (matrice de convolution), créé une fois dans le document. */
function ensureSharpenFilter(amount: number): string {
  const id = "avatar-sharpen";
  let svg = document.getElementById(`${id}-svg`) as SVGSVGElement | null;
  if (!svg) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = `${id}-svg`;
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.position = "absolute";
    document.body.appendChild(svg);
  }
  const host: SVGSVGElement = svg;
  if (sharpenAmount !== amount) {
    sharpenAmount = amount;
    const a = amount.toFixed(3);
    const c = (1 + 4 * amount).toFixed(3);
    host.innerHTML = `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feConvolveMatrix order="3" kernelMatrix="0 -${a} 0 -${a} ${c} -${a} 0 -${a} 0" divisor="1" preserveAlpha="true" edgeMode="duplicate"/></filter>`;
  }
  return `url(#${id})`;
}

/** Applique une netteté (masque flou inversé) sur place à un canvas 2D. */
export function sharpenCanvas(canvas: HTMLCanvasElement, amount: number): void {
  if (amount <= 0) return;
  const ctx = canvas.getContext("2d")!;
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext("2d")!.drawImage(canvas, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = "copy";
  ctx.filter = ensureSharpenFilter(Math.min(1, amount) * 0.6);
  ctx.drawImage(copy, 0, 0);
  ctx.restore();
}
