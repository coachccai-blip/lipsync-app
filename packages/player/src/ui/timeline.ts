import type { AllConfig, ExpressionSegment, GestureEvent, Performance } from "@avatar/shared";

export type Selection = { kind: "expression" | "gesture"; index: number };

export interface TimelineCallbacks {
  onSeek(t: number): void;
  onSelect(sel: Selection | null): void;
  /** Le contenu de performance.json a changé (déplacement, ajout, suppression). */
  onChange(): void;
}

const SHAPE_COLORS: Record<string, string> = { X: "#3a4048", A: "#c0392b", B: "#e67e22", C: "#f1c40f", D: "#2ecc71", E: "#1abc9c", F: "#3498db", G: "#9b59b6", H: "#e84393" };
export const EMOTION_COLORS = ["#4f8fe6", "#e67e22", "#2ecc71", "#9b59b6", "#e84393", "#1abc9c", "#f1c40f", "#c0392b", "#7f8c8d"];

const ROWS = ["mots", "visèmes", "émotions", "gestes", "énergie"] as const;
const RULER = 22;

/**
 * Timeline éditable : mots (clic = aller à), visèmes, émotions et gestes (clic = sélection,
 * glisser = déplacer, double-clic = ajouter), énergie et accents, tête de lecture, zoom.
 */
export class Timeline {
  readonly canvas: HTMLCanvasElement;
  selection: Selection | null = null;
  private perf?: Performance;
  private cfg?: AllConfig;
  private t = 0;
  private pxPerSec = 80;
  private scroll = 0;
  private drag?: { kind: "seek" | "move"; sel?: Selection; startX: number; origStart: number; origEnd: number; moved: boolean };
  private ro: ResizeObserver;

  constructor(private readonly container: HTMLElement, private readonly cb: TimelineCallbacks) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "timeline";
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.canvas.addEventListener("mousedown", (e) => this.onDown(e));
    window.addEventListener("mousemove", (e) => this.onMove(e));
    window.addEventListener("mouseup", (e) => this.onUp(e));
    this.canvas.addEventListener("dblclick", (e) => this.onDblClick(e));
    this.canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    this.resize();
  }

  setData(perf: Performance, cfg: AllConfig): void {
    const first = !this.perf;
    this.perf = perf;
    this.cfg = cfg;
    if (this.selection) {
      const list = this.selection.kind === "expression" ? perf.expressions : perf.gestures;
      if (this.selection.index >= list.length) this.selection = null;
    }
    if (first) this.fit();
    else this.draw();
  }

  setTime(t: number): void {
    this.t = t;
    // suivre la tête de lecture
    const x = this.x(t);
    const W = this.canvas.clientWidth;
    if (x > W - 20 || x < 0) this.scroll = Math.max(0, t - (W * 0.2) / this.pxPerSec);
    this.draw();
  }

  select(sel: Selection | null): void {
    this.selection = sel;
    this.draw();
  }

  fit(): void {
    const D = Math.max(0.001, this.perf?.duration ?? 1);
    this.pxPerSec = Math.max(4, (this.canvas.clientWidth - 8) / D);
    this.scroll = 0;
    this.draw();
  }

  zoom(factor: number, aroundT = this.t): void {
    const before = this.x(aroundT);
    this.pxPerSec = Math.min(2000, Math.max(4, this.pxPerSec * factor));
    this.scroll = Math.max(0, aroundT - before / this.pxPerSec);
    this.draw();
  }

  private resize(): void {
    const dpr = devicePixelRatio || 1;
    this.canvas.width = Math.max(1, this.container.clientWidth * dpr);
    this.canvas.height = Math.max(1, this.container.clientHeight * dpr);
    this.draw();
  }

  private x(t: number): number {
    return (t - this.scroll) * this.pxPerSec;
  }
  private tAt(px: number): number {
    return Math.max(0, Math.min(this.perf?.duration ?? 0, px / this.pxPerSec + this.scroll));
  }
  private rowOf(y: number): number {
    const h = (this.canvas.clientHeight - RULER) / ROWS.length;
    return Math.floor((y - RULER) / h);
  }
  private gestureDuration(g: GestureEvent): number {
    return this.cfg?.gestures.procedural[g.clip]?.duration ?? 1.5;
  }

  private hit(px: number, py: number): Selection | null {
    if (!this.perf) return null;
    const row = this.rowOf(py);
    const t = this.tAt(px);
    if (row === 2) {
      for (let i = this.perf.expressions.length - 1; i >= 0; i--) {
        const e = this.perf.expressions[i];
        if (t >= e.start && t <= e.end) return { kind: "expression", index: i };
      }
    }
    if (row === 3) {
      for (let i = this.perf.gestures.length - 1; i >= 0; i--) {
        const g = this.perf.gestures[i];
        if (t >= g.at && t <= g.at + this.gestureDuration(g)) return { kind: "gesture", index: i };
      }
    }
    return null;
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown(e: MouseEvent): void {
    if (!this.perf) return;
    const { x, y } = this.local(e);
    this.canvas.focus();
    const sel = this.hit(x, y);
    if (sel) {
      const item = sel.kind === "expression" ? this.perf.expressions[sel.index] : this.perf.gestures[sel.index];
      const start = "start" in item ? item.start : item.at;
      const end = "end" in item ? item.end : item.at;
      this.drag = { kind: "move", sel, startX: x, origStart: start, origEnd: end, moved: false };
      this.selection = sel;
      this.cb.onSelect(sel);
      this.draw();
      return;
    }
    const row = this.rowOf(y);
    if (row === 0) {
      const t = this.tAt(x);
      const w = this.perf.words.find((w) => t >= w.start && t <= w.end);
      if (w) {
        this.cb.onSeek(w.start);
        return;
      }
    }
    this.drag = { kind: "seek", startX: x, origStart: 0, origEnd: 0, moved: false };
    this.cb.onSeek(this.tAt(x));
    if (this.selection && row !== 2 && row !== 3) {
      this.selection = null;
      this.cb.onSelect(null);
    }
  }

  private onMove(e: MouseEvent): void {
    if (!this.drag || !this.perf) return;
    const { x } = this.local(e);
    if (this.drag.kind === "seek") {
      this.cb.onSeek(this.tAt(x));
      return;
    }
    const dt = (x - this.drag.startX) / this.pxPerSec;
    if (Math.abs(x - this.drag.startX) > 3) this.drag.moved = true;
    const sel = this.drag.sel!;
    const D = this.perf.duration;
    if (sel.kind === "expression") {
      const seg = this.perf.expressions[sel.index];
      const len = this.drag.origEnd - this.drag.origStart;
      seg.start = round(Math.max(0, Math.min(D - len, this.drag.origStart + dt)));
      seg.end = round(seg.start + len);
    } else {
      const g = this.perf.gestures[sel.index];
      g.at = round(Math.max(0, Math.min(D, this.drag.origStart + dt)));
    }
    this.draw();
  }

  private onUp(_e: MouseEvent): void {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = undefined;
    if (d.kind === "move" && d.moved) this.cb.onChange();
  }

  private onDblClick(e: MouseEvent): void {
    if (!this.perf || !this.cfg) return;
    const { x, y } = this.local(e);
    if (this.hit(x, y)) return;
    const row = this.rowOf(y);
    const t = round(this.tAt(x));
    if (row === 2) {
      const emotions = Object.keys(this.cfg.emotions.emotions).filter((n) => n !== "neutre");
      const seg: ExpressionSegment = { start: t, end: round(Math.min(this.perf.duration, t + 2)), emotion: emotions[0] ?? "neutre", intensity: 0.8, source: "manuel" };
      this.perf.expressions.push(seg);
      this.perf.expressions.sort((a, b) => a.start - b.start);
      this.selection = { kind: "expression", index: this.perf.expressions.indexOf(seg) };
    } else if (row === 3) {
      const clips = Object.keys(this.cfg.gestures.procedural);
      const g: GestureEvent = { at: t, clip: clips[0] ?? "salut", source: "manuel" };
      this.perf.gestures.push(g);
      this.perf.gestures.sort((a, b) => a.at - b.at);
      this.selection = { kind: "gesture", index: this.perf.gestures.indexOf(g) };
    } else return;
    this.cb.onChange();
    this.cb.onSelect(this.selection);
    this.draw();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const { x } = this.local(e);
    if (e.ctrlKey || e.metaKey) this.zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, this.tAt(x));
    else {
      this.scroll = Math.max(0, this.scroll + (e.deltaY + e.deltaX) / this.pxPerSec);
      this.draw();
    }
  }

  /** Supprime l'élément sélectionné. */
  deleteSelection(): boolean {
    if (!this.perf || !this.selection) return false;
    if (this.selection.kind === "expression") this.perf.expressions.splice(this.selection.index, 1);
    else this.perf.gestures.splice(this.selection.index, 1);
    this.selection = null;
    this.cb.onChange();
    this.cb.onSelect(null);
    this.draw();
    return true;
  }

  draw(): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const dpr = devicePixelRatio || 1;
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(this.canvas);
    const colBg = css.getPropertyValue("--tl-bg") || "#0d0f12";
    const colBg2 = css.getPropertyValue("--tl-bg2") || "#111418";
    const colText = css.getPropertyValue("--tl-text") || "#c8ccd2";
    const colMuted = css.getPropertyValue("--tl-muted") || "#7d838c";
    const colAccent = css.getPropertyValue("--tl-accent") || "#7cc4ff";
    ctx.fillStyle = colBg;
    ctx.fillRect(0, 0, W, H);
    const perf = this.perf;
    const cfg = this.cfg;
    if (!perf || !cfg) {
      ctx.fillStyle = colMuted;
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText("Aucun projet chargé", 12, 40);
      return;
    }
    const rowH = (H - RULER) / ROWS.length;
    const x = (t: number) => this.x(t);
    ctx.font = "11px system-ui, sans-serif";

    // règle
    const step = niceStep(this.pxPerSec);
    ctx.fillStyle = colBg2;
    ctx.fillRect(0, 0, W, RULER);
    ctx.fillStyle = colMuted;
    ctx.strokeStyle = colMuted;
    for (let t = Math.floor(this.scroll / step) * step; t <= perf.duration + step; t += step) {
      const px = x(t);
      if (px < -50 || px > W + 50) continue;
      ctx.fillRect(px, RULER - 6, 1, 6);
      ctx.fillText(t.toFixed(step < 1 ? 1 : 0) + " s", px + 3, 13);
    }
    // fond des lignes
    ROWS.forEach((_, i) => {
      ctx.fillStyle = i % 2 ? colBg2 : colBg;
      ctx.fillRect(0, RULER + i * rowH, W, rowH);
    });
    // fin du projet
    ctx.fillStyle = "rgba(127,127,127,0.25)";
    ctx.fillRect(x(perf.duration), RULER, Math.max(0, W - x(perf.duration)), H - RULER);
    const clipRow = (i: number, fn: () => void) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, RULER + i * rowH, W, rowH);
      ctx.clip();
      fn();
      ctx.restore();
    };
    // mots
    clipRow(0, () => {
      for (const w of perf.words) {
        const px = x(w.start);
        const pw = Math.max(2, x(w.end) - px - 1);
        if (px + pw < 0 || px > W) continue;
        const active = this.t >= w.start && this.t < w.end;
        ctx.fillStyle = active ? colAccent : "rgba(127,150,180,0.35)";
        ctx.fillRect(px, RULER + 5, pw, rowH - 10);
        if (pw > 14) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(px, RULER, pw, rowH);
          ctx.clip();
          ctx.fillStyle = active ? "#0b1016" : colText;
          ctx.fillText(w.w, px + 3, RULER + rowH * 0.65);
          ctx.restore();
        }
      }
    });
    // visèmes
    clipRow(1, () => {
      for (const v of perf.visemes) {
        const px = x(v.start);
        const pw = Math.max(1, x(v.end) - px);
        if (px + pw < 0 || px > W) continue;
        ctx.fillStyle = SHAPE_COLORS[v.shape] ?? "#888";
        ctx.fillRect(px, RULER + rowH + 7, pw, rowH - 14);
        if (pw > 12) {
          ctx.fillStyle = "#000000aa";
          ctx.fillText(v.shape, px + 3, RULER + rowH + rowH * 0.65);
        }
      }
    });
    // émotions
    const emotions = Object.keys(cfg.emotions.emotions);
    clipRow(2, () => {
      perf.expressions.forEach((e, i) => {
        const px = x(e.start);
        const pw = Math.max(2, x(e.end) - px);
        if (px + pw < 0 || px > W) return;
        const selected = this.selection?.kind === "expression" && this.selection.index === i;
        ctx.globalAlpha = 0.35 + 0.65 * e.intensity;
        ctx.fillStyle = EMOTION_COLORS[Math.max(0, emotions.indexOf(e.emotion)) % EMOTION_COLORS.length];
        roundRect(ctx, px, RULER + 2 * rowH + 6, pw, rowH - 12, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (selected) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2;
          roundRect(ctx, px, RULER + 2 * rowH + 6, pw, rowH - 12, 4);
          ctx.stroke();
        }
        ctx.fillStyle = "#fff";
        ctx.fillText(`${e.emotion}${e.source === "balise" ? " [b]" : e.source === "manuel" ? " ✎" : ""} ${Math.round(e.intensity * 100)}%`, px + 4, RULER + 2 * rowH + rowH * 0.65);
      });
    });
    // gestes
    clipRow(3, () => {
      perf.gestures.forEach((g, i) => {
        const px = x(g.at);
        const pw = Math.max(3, x(g.at + this.gestureDuration(g)) - px);
        if (px + pw < 0 || px > W) return;
        const selected = this.selection?.kind === "gesture" && this.selection.index === i;
        ctx.fillStyle = g.source === "balise" ? "#ffcc66" : g.source === "manuel" ? "#b8f0c4" : "#7cc4ff";
        roundRect(ctx, px, RULER + 3 * rowH + 6, pw, rowH - 12, 4);
        ctx.fill();
        if (selected) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2;
          roundRect(ctx, px, RULER + 3 * rowH + 6, pw, rowH - 12, 4);
          ctx.stroke();
        }
        ctx.fillStyle = "#101418";
        ctx.fillText(g.clip, px + 4, RULER + 3 * rowH + rowH * 0.65);
      });
    });
    // énergie + accents
    clipRow(4, () => {
      const y0 = RULER + 5 * rowH - 4;
      ctx.strokeStyle = colAccent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const startI = Math.max(0, Math.floor(this.scroll * perf.energy.rate));
      const endI = Math.min(perf.energy.values.length, Math.ceil((this.scroll + W / this.pxPerSec) * perf.energy.rate) + 1);
      for (let i = startI; i < endI; i++) {
        const px = x(i / perf.energy.rate);
        const py = y0 - perf.energy.values[i] * (rowH - 10);
        if (i === startI) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.fillStyle = "#ff9f43";
      for (const a of perf.accents) ctx.fillRect(x(a) - 1, RULER + 4 * rowH + 3, 2, rowH - 6);
    });
    // libellés de lignes
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, RULER, 64, H - RULER);
    ctx.fillStyle = colText;
    ROWS.forEach((r, i) => ctx.fillText(r, 6, RULER + i * rowH + 14));
    // tête de lecture
    const px = x(this.t);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(px - 1, 0, 2, H);
    ctx.beginPath();
    ctx.moveTo(px - 6, 0);
    ctx.lineTo(px + 6, 0);
    ctx.lineTo(px, 8);
    ctx.closePath();
    ctx.fill();
  }
}

function niceStep(pxPerSec: number): number {
  const target = 80 / pxPerSec;
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60];
  return steps.find((s) => s >= target) ?? 60;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const round = (v: number) => Math.round(v * 1000) / 1000;
