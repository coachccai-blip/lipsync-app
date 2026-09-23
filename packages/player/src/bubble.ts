import type { SceneConfig } from "@avatar/shared";

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
  Object.assign(bubble.style, {
    width: `${d}px`,
    height: `${d}px`,
    left: `${Math.round(cx - d / 2)}px`,
    top: `${Math.round(cy - d / 2)}px`,
    background: cfg.bubble.background,
  });
  ring.style.boxShadow = cfg.bubble.ring.enabled ? `inset 0 0 0 ${cfg.bubble.ring.width}px ${cfg.bubble.ring.color}` : "none";
  return d;
}
