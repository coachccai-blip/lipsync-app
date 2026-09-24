import { PARALLAX_OVERSCAN, bubbleBackground, bubbleCornerRadius, bubbleParallax, type SceneConfig } from "@avatar/shared";

/** Met en page la bulle CSS (taille, position, fond, anneau) et renvoie son diamètre. */
export function layoutBubble(cfg: SceneConfig, background: "green" | "transparent"): number {
  const page = document.getElementById("page")!;
  const bubble = document.getElementById("bubble")!;
  const ring = document.getElementById("ring")!;
  const { width, height } = cfg.resolution;
  document.documentElement.style.setProperty("--page-w", `${width}px`);
  document.documentElement.style.setProperty("--page-h", `${height}px`);
  document.documentElement.style.setProperty("--page-bg", cfg.background.color);
  document.body.classList.toggle("transparent", background === "transparent");
  void page;
  const d = cfg.bubble.diameter === "auto" ? Math.min(width, height) - 2 * cfg.bubble.margin : cfg.bubble.diameter;
  const pos = cfg.bubble.position ?? { x: "center", y: "center" };
  const cx = pos.x === "center" ? width / 2 : pos.x;
  const cy = pos.y === "center" ? height / 2 : pos.y;
  const radius = `${bubbleCornerRadius(cfg.bubble, d)}px`;
  Object.assign(bubble.style, {
    width: `${d}px`,
    height: `${d}px`,
    left: `${Math.round(cx - d / 2)}px`,
    top: `${Math.round(cy - d / 2)}px`,
    background: bubbleBackground(cfg.bubble),
    borderRadius: radius,
  });
  ring.style.borderRadius = radius;
  ring.style.boxShadow = cfg.bubble.ring.enabled ? `inset 0 0 0 ${cfg.bubble.ring.width}px ${cfg.bubble.ring.color}` : "none";
  return d;
}

/** Géométrie de la bulle dans la page : diamètre et centre (pixels). */
export function bubbleGeometry(cfg: SceneConfig): { d: number; cx: number; cy: number } {
  const { width, height } = cfg.resolution;
  const d = cfg.bubble.diameter === "auto" ? Math.min(width, height) - 2 * cfg.bubble.margin : cfg.bubble.diameter;
  const pos = cfg.bubble.position ?? { x: "center", y: "center" };
  return { d, cx: pos.x === "center" ? width / 2 : pos.x, cy: pos.y === "center" ? height / 2 : pos.y };
}

/** Glissement du fond de bulle selon la tête (parallaxe), à appeler à chaque image. */
export function applyBubbleMotion(cfg: SceneConfig, head: [number, number, number] | undefined): void {
  const bubble = document.getElementById("bubble");
  if (!bubble) return;
  const px = cfg.bubble.parallaxe ?? 0;
  if (!px) {
    bubble.style.backgroundSize = "";
    bubble.style.backgroundPosition = "";
    return;
  }
  const { dx, dy } = bubbleParallax(head, px);
  const over = `${PARALLAX_OVERSCAN * 100}%`;
  bubble.style.backgroundSize = `${over} ${over}`;
  bubble.style.backgroundPosition = `calc(50% + ${dx.toFixed(2)}px) calc(50% + ${dy.toFixed(2)}px)`;
}
