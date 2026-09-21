import { activeGestureAt, dominantEmotionAt, type AllConfig, type Performance } from "@avatar/shared";

const SHAPE_COLORS: Record<string, string> = { X: "#2a2f36", A: "#c0392b", B: "#e67e22", C: "#f1c40f", D: "#2ecc71", E: "#1abc9c", F: "#3498db", G: "#9b59b6", H: "#e84393" };
const EMOTION_COLORS = ["#3498db", "#e67e22", "#2ecc71", "#9b59b6", "#e84393", "#1abc9c", "#f1c40f", "#c0392b"];

/**
 * Prévisualisation temps réel : lecture audio, barre de temps, pistes (mots, visèmes,
 * émotions, gestes, énergie, accents). Le rendu passe par le même renderFrame(t) que le
 * rendu hors ligne ; seule l'horloge (audio ou rAF) diffère.
 */
export class PreviewUI {
  private perf?: Performance;
  private cfg?: AllConfig;
  private audio?: HTMLAudioElement;
  private clockStart = 0;
  private clockOffset = 0;
  private playing = false;
  private t = 0;
  private lastRendered = -1;
  private readonly playBtn = document.getElementById("play") as HTMLButtonElement;
  private readonly timeEl = document.getElementById("time")!;
  private readonly seek = document.getElementById("seek") as HTMLInputElement;
  private readonly loop = document.getElementById("loop") as HTMLInputElement;
  private readonly tracks = document.getElementById("tracks") as HTMLCanvasElement;
  private readonly statusEl = document.getElementById("status")!;

  constructor(private readonly renderFrame: (t: number) => Promise<void>) {
    document.body.classList.add("ui");
    this.playBtn.addEventListener("click", () => this.toggle());
    document.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        this.toggle();
      }
    });
    this.seek.addEventListener("input", () => this.seekTo((Number(this.seek.value) / 1000) * this.duration()));
    this.tracks.addEventListener("click", (e) => {
      const r = this.tracks.getBoundingClientRect();
      this.seekTo(((e.clientX - r.left) / r.width) * this.duration());
    });
    window.addEventListener("resize", () => this.fit());
    requestAnimationFrame(() => this.tick());
  }

  status(msg: string, cls = ""): void {
    this.statusEl.textContent = msg;
    this.statusEl.className = cls;
  }

  setProject(perf: Performance, cfg: AllConfig, audioUrl?: string): void {
    const wasPlaying = this.playing;
    const keepT = this.perf ? this.t : 0;
    this.pause();
    this.perf = perf;
    this.cfg = cfg;
    if (this.audio && this.audio.src !== audioUrl) {
      this.audio.pause();
      this.audio = undefined;
    }
    if (audioUrl && !this.audio) {
      this.audio = new Audio(audioUrl);
      this.audio.preload = "auto";
    }
    this.fit();
    this.lastRendered = -1;
    this.seekTo(Math.min(keepT, perf.duration));
    if (wasPlaying) this.play();
  }

  private duration(): number {
    return this.perf?.duration ?? 0;
  }

  /** Ajuste l'échelle CSS de la page pour qu'elle tienne dans la fenêtre. */
  fit(): void {
    if (!this.cfg) return;
    const { width, height } = this.cfg.scene.resolution;
    const viewport = document.getElementById("viewport")!;
    const scale = Math.min(1, (window.innerWidth - 32) / width, (window.innerHeight * 0.6) / height);
    viewport.style.transform = `scale(${scale})`;
    viewport.style.width = `${width * scale}px`;
    viewport.style.height = `${height * scale}px`;
    this.tracks.width = Math.min(1400, window.innerWidth - 32) * devicePixelRatio;
    this.tracks.height = 190 * devicePixelRatio;
    this.draw();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  play(): void {
    if (!this.perf) return;
    if (this.t >= this.duration() - 0.01) this.t = 0;
    this.playing = true;
    this.playBtn.textContent = "⏸ Pause";
    if (this.audio) {
      this.audio.currentTime = this.t;
      void this.audio.play().catch(() => undefined);
    } else {
      this.clockStart = performance.now();
      this.clockOffset = this.t;
    }
  }

  pause(): void {
    this.playing = false;
    this.playBtn.textContent = "▶ Lecture";
    this.audio?.pause();
  }

  seekTo(t: number): void {
    this.t = Math.max(0, Math.min(this.duration(), t));
    if (this.audio) this.audio.currentTime = this.t;
    else {
      this.clockStart = performance.now();
      this.clockOffset = this.t;
    }
  }

  private tick(): void {
    requestAnimationFrame(() => this.tick());
    if (!this.perf) return;
    if (this.playing) {
      this.t = this.audio ? this.audio.currentTime : this.clockOffset + (performance.now() - this.clockStart) / 1000;
      if (this.t >= this.duration()) {
        if (this.loop.checked) {
          this.t = 0;
          this.seekTo(0);
        } else {
          this.t = this.duration();
          this.pause();
        }
      }
    }
    // rendu à la cadence du projet (pas plus vite) pour rester fidèle à la sortie
    const frame = Math.floor(this.t * this.perf.fps);
    if (frame !== this.lastRendered) {
      this.lastRendered = frame;
      void this.renderFrame(frame / this.perf.fps);
      this.timeEl.textContent = `${this.t.toFixed(2)} / ${this.duration().toFixed(2)} s`;
      this.seek.value = String(Math.round((this.t / Math.max(0.001, this.duration())) * 1000));
      this.draw();
    }
  }

  private draw(): void {
    const perf = this.perf;
    const cfg = this.cfg;
    const ctx = this.tracks.getContext("2d");
    if (!perf || !cfg || !ctx) return;
    const W = this.tracks.width;
    const H = this.tracks.height;
    const dpr = devicePixelRatio;
    const D = Math.max(0.001, perf.duration);
    const x = (t: number) => (t / D) * W;
    ctx.clearRect(0, 0, W, H);
    ctx.font = `${11 * dpr}px system-ui, sans-serif`;
    const rows = [
      { label: "mots", y: 0 },
      { label: "visèmes", y: 1 },
      { label: "émotions", y: 2 },
      { label: "gestes", y: 3 },
      { label: "énergie", y: 4 },
    ];
    const rowH = H / rows.length;
    for (const r of rows) {
      ctx.fillStyle = r.y % 2 ? "#111418" : "#0d0f12";
      ctx.fillRect(0, r.y * rowH, W, rowH);
    }
    // mots
    for (const w of perf.words) {
      ctx.fillStyle = "#2f3b4a";
      ctx.fillRect(x(w.start), 4 * dpr, Math.max(1, x(w.end) - x(w.start) - 1), rowH - 8 * dpr);
      ctx.fillStyle = "#dfe6ee";
      ctx.save();
      ctx.beginPath();
      ctx.rect(x(w.start), 0, x(w.end) - x(w.start), rowH);
      ctx.clip();
      ctx.fillText(w.w, x(w.start) + 3 * dpr, rowH * 0.65);
      ctx.restore();
    }
    // visèmes
    for (const v of perf.visemes) {
      ctx.fillStyle = SHAPE_COLORS[v.shape] ?? "#888";
      ctx.fillRect(x(v.start), rowH + 6 * dpr, Math.max(1, x(v.end) - x(v.start)), rowH - 12 * dpr);
    }
    // émotions
    const emotions = Object.keys(cfg.emotions.emotions);
    for (const e of perf.expressions) {
      const idx = Math.max(0, emotions.indexOf(e.emotion));
      ctx.fillStyle = EMOTION_COLORS[idx % EMOTION_COLORS.length];
      ctx.globalAlpha = 0.35 + 0.65 * e.intensity;
      ctx.fillRect(x(e.start), 2 * rowH + 6 * dpr, Math.max(1, x(e.end) - x(e.start)), rowH - 12 * dpr);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff";
      ctx.fillText(`${e.emotion} ${e.source === "balise" ? "[balise]" : ""}`, x(e.start) + 3 * dpr, 2 * rowH + rowH * 0.65);
    }
    // gestes
    for (const g of perf.gestures) {
      const dur = cfg.gestures.procedural[g.clip]?.duration ?? 1.5;
      ctx.fillStyle = g.source === "balise" ? "#ffcc66" : "#7cc4ff";
      ctx.fillRect(x(g.at), 3 * rowH + 6 * dpr, Math.max(2, x(g.at + dur) - x(g.at)), rowH - 12 * dpr);
      ctx.fillStyle = "#101010";
      ctx.fillText(g.clip, x(g.at) + 3 * dpr, 3 * rowH + rowH * 0.65);
    }
    // énergie + accents
    ctx.strokeStyle = "#8fd3ff";
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    perf.energy.values.forEach((v, i) => {
      const px = x(i / perf.energy.rate);
      const py = 5 * rowH - 4 * dpr - v * (rowH - 8 * dpr);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.fillStyle = "#ff9f43";
    for (const a of perf.accents) ctx.fillRect(x(a) - dpr, 4 * rowH + 2 * dpr, 2 * dpr, rowH - 4 * dpr);
    // libellés
    ctx.fillStyle = "#9aa0a6";
    for (const r of rows) ctx.fillText(r.label, 4 * dpr, r.y * rowH + 12 * dpr);
    // tête de lecture
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x(this.t) - dpr, 0, 2 * dpr, H);
    const emotion = dominantEmotionAt(this.t, perf.expressions) ?? "neutre";
    const gesture = activeGestureAt(this.t, perf.gestures, cfg.gestures);
    ctx.fillStyle = "#ffffffcc";
    ctx.fillText(`${emotion}${gesture ? ` · ${gesture.clip}` : ""}`, Math.min(W - 120 * dpr, x(this.t) + 6 * dpr), H - 6 * dpr);
  }
}
