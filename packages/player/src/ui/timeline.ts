import type { AllConfig, ExpressionSegment, GestureEvent, Performance } from "@avatar/shared";
import { drawSpectrogram, drawWave, type AudioAnalysis } from "./audio.js";

export type Selection = { kind: "expression" | "gesture"; index: number };

export interface TimelineCallbacks {
  onSeek(t: number): void;
  onSelect(sel: Selection | null): void;
  /** Le contenu de performance.json a changé (déplacement, ajout, suppression). */
  onChange(): void;
}

const SHAPE_COLORS: Record<string, string> = { X: "#3a4048", A: "#c0392b", B: "#e67e22", C: "#f1c40f", D: "#2ecc71", E: "#1abc9c", F: "#3498db", G: "#9b59b6", H: "#e84393" };
export const EMOTION_COLORS = ["#4f8fe6", "#e67e22", "#2ecc71", "#9b59b6", "#e84393", "#1abc9c", "#f1c40f", "#c0392b", "#7f8c8d"];

type RowId = "audio" | "words" | "visemes" | "expressions" | "gestures" | "energy";
interface Row {
  id: RowId;
  label: string;
  /** Poids de hauteur (l'audio prend plus de place). */
  weight: number;
}
const ROWS: Row[] = [
  { id: "audio", label: "audio", weight: 2.6 },
  { id: "words", label: "mots", weight: 1 },
  { id: "visemes", label: "visèmes", weight: 1 },
  { id: "expressions", label: "émotions", weight: 1.15 },
  { id: "gestures", label: "gestes", weight: 1.15 },
  { id: "energy", label: "énergie", weight: 0.9 },
];
const RULER = 22;
const HEAD = 76;

/**
 * Timeline d'éditeur : piste audio (onde ou spectrogramme), mots (clic = aller à), visèmes,
 * émotions et gestes (clic = sélection, glisser = déplacer, bords = redimensionner,
 * double-clic = ajouter), énergie et accents, tête de lecture, zoom et défilement.
 */
export class Timeline {
  readonly canvas: HTMLCanvasElement;
  selection: Selection | null = null;
  /** Aimantation aux frontières de mots (s) ; 0 = désactivée. */
  snap = 0.06;
  /** Appelé juste avant une modification (pour l'historique d'annulation). */
  beforeChange?: () => void;
  audioView: "wave" | "spectro" = "wave";
  private audio?: AudioAnalysis;
  private perf?: Performance;
  private cfg?: AllConfig;
  private t = 0;
  private pxPerSec = 80;
  private scroll = 0;
  private drag?: { kind: "seek" | "move" | "resize-start" | "resize-end"; sel?: Selection; startX: number; origStart: number; origEnd: number; moved: boolean };
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
    this.canvas.addEventListener("mousemove", (e) => {
      if (this.drag) return;
      const { x, y } = this.local(e);
      this.canvas.style.cursor = this.cursorAt(x, y);
    });
    this.resize();
  }

  setData(perf: Performance | undefined, cfg: AllConfig | undefined): void {
    const first = !this.perf;
    this.perf = perf;
    this.cfg = cfg;
    if (this.selection && perf) {
      const list = this.selection.kind === "expression" ? perf.expressions : perf.gestures;
      if (this.selection.index >= list.length) this.selection = null;
    }
    if (first) this.fit();
    else this.draw();
  }

  setAudio(a: AudioAnalysis | undefined): void {
    this.audio = a;
    this.draw();
  }

  setTime(t: number): void {
    this.t = t;
    const x = this.x(t);
    const W = this.canvas.clientWidth;
    if (x > W - 20 || x < HEAD) this.scroll = Math.max(0, t - ((W - HEAD) * 0.2) / this.pxPerSec);
    this.draw();
  }

  select(sel: Selection | null): void {
    this.selection = sel;
    this.draw();
  }

  fit(): void {
    const D = Math.max(0.001, this.perf?.duration ?? 1);
    this.pxPerSec = Math.max(0.05, (this.canvas.clientWidth - HEAD - 8) / D);
    this.scroll = 0;
    this.draw();
  }

  zoom(factor: number, aroundT = this.t): void {
    const before = this.x(aroundT) - HEAD;
    const D = Math.max(0.001, this.perf?.duration ?? 1);
    const minPx = Math.min(4, (this.canvas.clientWidth - HEAD - 8) / D);
    this.pxPerSec = Math.min(4000, Math.max(minPx, this.pxPerSec * factor));
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
    return HEAD + (t - this.scroll) * this.pxPerSec;
  }
  private tAt(px: number): number {
    return Math.max(0, Math.min(this.perf?.duration ?? 0, (px - HEAD) / this.pxPerSec + this.scroll));
  }

  /** Géométrie des lignes (y, hauteur) pour la hauteur courante du canvas. */
  private rows(): (Row & { y: number; h: number })[] {
    const H = this.canvas.clientHeight - RULER;
    const total = ROWS.reduce((s, r) => s + r.weight, 0);
    let y = RULER;
    return ROWS.map((r) => {
      const h = (H * r.weight) / total;
      const out = { ...r, y, h };
      y += h;
      return out;
    });
  }
  private rowAt(y: number): RowId | undefined {
    return this.rows().find((r) => y >= r.y && y < r.y + r.h)?.id;
  }
  private gestureDuration(g: GestureEvent): number {
    return this.cfg?.gestures.procedural[g.clip]?.duration ?? 1.5;
  }

  private hit(px: number, py: number): Selection | null {
    if (!this.perf || px < HEAD) return null;
    const row = this.rowAt(py);
    const t = this.tAt(px);
    if (row === "expressions") {
      for (let i = this.perf.expressions.length - 1; i >= 0; i--) {
        const e = this.perf.expressions[i];
        if (t >= e.start && t <= e.end) return { kind: "expression", index: i };
      }
    }
    if (row === "gestures") {
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
    if (x < HEAD) return;
    this.canvas.focus();
    const sel = this.hit(x, y);
    if (sel) {
      const item = sel.kind === "expression" ? this.perf.expressions[sel.index] : this.perf.gestures[sel.index];
      const start = "start" in item ? item.start : item.at;
      const end = "end" in item ? item.end : item.at;
      let kind: "move" | "resize-start" | "resize-end" = "move";
      if (sel.kind === "expression") {
        if (Math.abs(x - this.x(start)) < 6) kind = "resize-start";
        else if (Math.abs(x - this.x(end)) < 6) kind = "resize-end";
      }
      this.drag = { kind, sel, startX: x, origStart: start, origEnd: end, moved: false };
      this.beforeChange?.();
      this.selection = sel;
      this.cb.onSelect(sel);
      this.draw();
      return;
    }
    const row = this.rowAt(y);
    if (row === "words") {
      const t = this.tAt(x);
      const w = this.perf.words.find((w) => t >= w.start && t <= w.end);
      if (w) {
        this.cb.onSeek(w.start);
        return;
      }
    }
    this.drag = { kind: "seek", startX: x, origStart: 0, origEnd: 0, moved: false };
    this.cb.onSeek(this.tAt(x));
    if (this.selection && row !== "expressions" && row !== "gestures") {
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
    const snap = e.altKey ? (t: number) => t : (t: number) => this.snapTo(t);
    if (sel.kind === "expression") {
      const seg = this.perf.expressions[sel.index];
      if (this.drag.kind === "resize-start") seg.start = round(Math.max(0, Math.min(seg.end - 0.1, snap(this.drag.origStart + dt))));
      else if (this.drag.kind === "resize-end") seg.end = round(Math.min(D, Math.max(seg.start + 0.1, snap(this.drag.origEnd + dt))));
      else {
        const len = this.drag.origEnd - this.drag.origStart;
        seg.start = round(Math.max(0, Math.min(D - len, snap(this.drag.origStart + dt))));
        seg.end = round(seg.start + len);
      }
    } else {
      const g = this.perf.gestures[sel.index];
      g.at = round(Math.max(0, Math.min(D, snap(this.drag.origStart + dt))));
    }
    this.draw();
  }

  private onUp(_e: MouseEvent): void {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = undefined;
    if (d.kind !== "seek" && d.moved) this.cb.onChange();
  }

  private snapTo(t: number): number {
    if (!this.perf || this.snap <= 0) return t;
    let best = t;
    let bestD = this.snap;
    for (const w of this.perf.words) {
      for (const b of [w.start, w.end]) {
        const d = Math.abs(b - t);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
    }
    return best;
  }

  cursorAt(px: number, py: number): string {
    if (!this.perf || px < HEAD) return "default";
    const sel = this.hit(px, py);
    if (!sel) return "crosshair";
    if (sel.kind === "expression") {
      const e = this.perf.expressions[sel.index];
      if (Math.abs(px - this.x(e.start)) < 6 || Math.abs(px - this.x(e.end)) < 6) return "ew-resize";
    }
    return "grab";
  }

  private onDblClick(e: MouseEvent): void {
    if (!this.perf || !this.cfg) return;
    const { x, y } = this.local(e);
    if (x < HEAD || this.hit(x, y)) return;
    const row = this.rowAt(y);
    const t = round(this.tAt(x));
    if (row !== "expressions" && row !== "gestures") return;
    this.beforeChange?.();
    if (row === "expressions") {
      const emotions = Object.keys(this.cfg.emotions.emotions).filter((n) => n !== "neutre");
      const seg: ExpressionSegment = { start: t, end: round(Math.min(this.perf.duration, t + 2)), emotion: emotions[0] ?? "neutre", intensity: 0.8, source: "manuel" };
      this.perf.expressions.push(seg);
      this.perf.expressions.sort((a, b) => a.start - b.start);
      this.selection = { kind: "expression", index: this.perf.expressions.indexOf(seg) };
    } else {
      const clips = Object.keys(this.cfg.gestures.procedural);
      const g: GestureEvent = { at: t, clip: clips[0] ?? "salut", source: "manuel" };
      this.perf.gestures.push(g);
      this.perf.gestures.sort((a, b) => a.at - b.at);
      this.selection = { kind: "gesture", index: this.perf.gestures.indexOf(g) };
    }
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

  deleteSelection(): boolean {
    if (!this.perf || !this.selection) return false;
    this.beforeChange?.();
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
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const colBg = v("--tl-bg", "#0d0f12");
    const colBg2 = v("--tl-bg2", "#111418");
    const colHead = v("--tl-head", "#1a1e24");
    const colText = v("--tl-text", "#c8ccd2");
    const colMuted = v("--tl-muted", "#7d838c");
    const colAccent = v("--tl-accent", "#7cc4ff");
    const colWave = v("--tl-wave", "#5aa9e6");
    ctx.fillStyle = colBg;
    ctx.fillRect(0, 0, W, H);
    const perf = this.perf;
    const cfg = this.cfg;
    ctx.font = "11px system-ui, sans-serif";
    const rows = this.rows();
    // fonds de lignes et en-têtes
    rows.forEach((r, i) => {
      ctx.fillStyle = i % 2 ? colBg2 : colBg;
      ctx.fillRect(HEAD, r.y, W - HEAD, r.h);
      ctx.fillStyle = colHead;
      ctx.fillRect(0, r.y, HEAD, r.h);
      ctx.fillStyle = colText;
      ctx.fillText(r.label, 8, r.y + Math.min(r.h / 2 + 4, 16));
      ctx.fillStyle = colBg2;
      ctx.fillRect(0, r.y + r.h - 1, W, 1);
    });
    ctx.fillStyle = colHead;
    ctx.fillRect(0, 0, W, RULER);
    if (!perf || !cfg) {
      ctx.fillStyle = colMuted;
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText("Aucun projet chargé", HEAD + 12, RULER + 30);
      return;
    }
    const x = (t: number) => this.x(t);
    const t0 = this.scroll;
    const t1 = this.scroll + (W - HEAD) / this.pxPerSec;
    const clipArea = (r: { y: number; h: number }, fn: () => void) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(HEAD, r.y, W - HEAD, r.h);
      ctx.clip();
      fn();
      ctx.restore();
    };
    const row = (id: RowId) => rows.find((r) => r.id === id)!;

    // règle
    const step = niceStep(this.pxPerSec);
    ctx.fillStyle = colMuted;
    for (let t = Math.floor(t0 / step) * step; t <= Math.min(perf.duration, t1) + step; t += step) {
      const px = x(t);
      if (px < HEAD || px > W) continue;
      ctx.fillRect(px, RULER - 6, 1, 6);
      ctx.fillText(fmtRuler(t, step), px + 3, 13);
    }
    // fin du projet
    ctx.fillStyle = "rgba(127,127,127,0.25)";
    if (x(perf.duration) < W) ctx.fillRect(x(perf.duration), RULER, W - x(perf.duration), H - RULER);

    // audio
    const ra = row("audio");
    clipArea(ra, () => {
      if (!this.audio) {
        ctx.fillStyle = colMuted;
        ctx.fillText("analyse de l'audio…", HEAD + 8, ra.y + ra.h / 2 + 4);
        return;
      }
      const w = Math.max(1, Math.min(W - HEAD, x(Math.min(perf.duration, t1)) - HEAD));
      const tEnd = t0 + w / this.pxPerSec;
      if (this.audioView === "spectro") drawSpectrogram(ctx, this.audio, HEAD, w, t0, tEnd, ra.y + 2, ra.h - 4);
      else drawWave(ctx, this.audio, HEAD, w, t0, tEnd, ra.y + 2, ra.h - 4, colWave);
    });
    // mots
    const rw = row("words");
    clipArea(rw, () => {
      for (const wd of perf.words) {
        if (wd.end < t0 || wd.start > t1) continue;
        const px = x(wd.start);
        const pw = Math.max(2, x(wd.end) - px - 1);
        const active = this.t >= wd.start && this.t < wd.end;
        ctx.fillStyle = active ? colAccent : "rgba(127,150,180,0.35)";
        ctx.fillRect(px, rw.y + 5, pw, rw.h - 10);
        if (pw > 14) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(px, rw.y, pw, rw.h);
          ctx.clip();
          ctx.fillStyle = active ? "#0b1016" : colText;
          ctx.fillText(wd.w, px + 3, rw.y + rw.h * 0.65);
          ctx.restore();
        }
      }
    });
    // visèmes
    const rv = row("visemes");
    clipArea(rv, () => {
      for (const vs of perf.visemes) {
        if (vs.end < t0 || vs.start > t1) continue;
        const px = x(vs.start);
        const pw = Math.max(1, x(vs.end) - px);
        ctx.fillStyle = SHAPE_COLORS[vs.shape] ?? "#888";
        ctx.fillRect(px, rv.y + 7, pw, rv.h - 14);
        if (pw > 12) {
          ctx.fillStyle = "#000000aa";
          ctx.fillText(vs.shape, px + 3, rv.y + rv.h * 0.65);
        }
      }
    });
    // émotions
    const re = row("expressions");
    const emotions = Object.keys(cfg.emotions.emotions);
    clipArea(re, () => {
      perf.expressions.forEach((e, i) => {
        if (e.end < t0 || e.start > t1) return;
        const px = x(e.start);
        const pw = Math.max(2, x(e.end) - px);
        const selected = this.selection?.kind === "expression" && this.selection.index === i;
        ctx.globalAlpha = 0.35 + 0.65 * e.intensity;
        ctx.fillStyle = EMOTION_COLORS[Math.max(0, emotions.indexOf(e.emotion)) % EMOTION_COLORS.length];
        roundRect(ctx, px, re.y + 6, pw, re.h - 12, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (selected) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2;
          roundRect(ctx, px, re.y + 6, pw, re.h - 12, 4);
          ctx.stroke();
        }
        ctx.fillStyle = "#fff";
        ctx.fillText(`${e.emotion}${e.source === "balise" ? " [b]" : e.source === "manuel" ? " ✎" : ""} ${Math.round(e.intensity * 100)}%`, px + 4, re.y + re.h * 0.62);
      });
    });
    // gestes
    const rg = row("gestures");
    clipArea(rg, () => {
      perf.gestures.forEach((g, i) => {
        const dur = this.gestureDuration(g);
        if (g.at + dur < t0 || g.at > t1) return;
        const px = x(g.at);
        const pw = Math.max(3, x(g.at + dur) - px);
        const selected = this.selection?.kind === "gesture" && this.selection.index === i;
        ctx.fillStyle = g.source === "balise" ? "#ffcc66" : g.source === "manuel" ? "#b8f0c4" : "#7cc4ff";
        roundRect(ctx, px, rg.y + 6, pw, rg.h - 12, 4);
        ctx.fill();
        if (selected) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2;
          roundRect(ctx, px, rg.y + 6, pw, rg.h - 12, 4);
          ctx.stroke();
        }
        ctx.fillStyle = "#101418";
        ctx.fillText(g.clip, px + 4, rg.y + rg.h * 0.62);
      });
    });
    // énergie + accents
    const rn = row("energy");
    clipArea(rn, () => {
      const y0 = rn.y + rn.h - 4;
      ctx.strokeStyle = colAccent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const startI = Math.max(0, Math.floor(t0 * perf.energy.rate));
      const endI = Math.min(perf.energy.values.length, Math.ceil(t1 * perf.energy.rate) + 1);
      for (let i = startI; i < endI; i++) {
        const px = x(i / perf.energy.rate);
        const py = y0 - perf.energy.values[i] * (rn.h - 10);
        if (i === startI) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.fillStyle = "#ff9f43";
      for (const a of perf.accents) if (a >= t0 && a <= t1) ctx.fillRect(x(a) - 1, rn.y + 3, 2, rn.h - 6);
    });
    // tête de lecture
    const px = x(this.t);
    if (px >= HEAD) {
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
}

function niceStep(pxPerSec: number): number {
  const target = 80 / pxPerSec;
  const steps = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600];
  return steps.find((s) => s >= target) ?? 600;
}

function fmtRuler(t: number, step: number): string {
  if (step >= 1) {
    const m = Math.floor(t / 60);
    const s = Math.round(t - m * 60);
    return m ? `${m}:${String(s).padStart(2, "0")}` : `${s} s`;
  }
  return `${t.toFixed(step < 0.1 ? 2 : 1)} s`;
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
