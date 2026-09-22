import type { AllConfig, ExpressionSegment, GestureEvent, Performance } from "@avatar/shared";
import { normalizePerformance, validatePerformance } from "@avatar/shared";
import type { LoadReport, ProjectPayload } from "../api.js";
import { api, type CheckItem, type JobEvent, type JobSummary, type ProjectSummary } from "./api.js";
import { FORMAT_PRESETS, SECTIONS, buildControls } from "./controls.js";
import { clear, download, fmtBytes, fmtTime, h, icon } from "./dom.js";
import { EMOTION_COLORS, Timeline } from "./timeline.js";
import { PoseEditor } from "./poses.js";

export interface PlayerLike {
  load(payload: ProjectPayload): Promise<LoadReport>;
  renderFrame(t: number): Promise<void>;
  report?: LoadReport;
}

type Tab = "projet" | "pistes" | "reglages" | "poses" | "rendu" | "journal";
const TABS: { id: Tab; label: string }[] = [
  { id: "projet", label: "Projet" },
  { id: "pistes", label: "Pistes" },
  { id: "reglages", label: "Réglages" },
  { id: "poses", label: "Poses" },
  { id: "rendu", label: "Rendu" },
  { id: "journal", label: "Journal" },
];
const JOB_LABELS: Record<JobSummary["type"], string> = { prepare: "Préparation", render: "Rendu", planche: "Planche", image: "Image" };

/**
 * Application studio : projets, préparation, lecture, timeline éditable, réglages en direct,
 * rendu et journal. En mode démo (GitHub Pages), les actions serveur sont remplacées par
 * le glisser-déposer et des téléchargements.
 */
export class StudioApp {
  private projects: ProjectSummary[] = [];
  private current?: string;
  private summary?: ProjectSummary;
  private payload?: ProjectPayload;
  private perf?: Performance;
  private cfg?: AllConfig;
  private dirtyPerf = false;
  private dirtyConfig = new Set<keyof AllConfig>();
  private tab: Tab = "projet";
  private timeline!: Timeline;
  private playing = false;
  private t = 0;
  private lastFrame = -1;
  private audio?: HTMLAudioElement;
  private audioUrl?: string;
  private clockStart = 0;
  private clockOffset = 0;
  private applyScheduled = false;
  private saveTimer?: number;
  private jobs: JobSummary[] = [];
  private jobLogs = new Map<string, JobEvent[]>();
  private activeJobId?: string;
  private prepareInput?: { kind: "audio" | "texte"; file: string };
  private busy = false;
  private history: string[] = [];
  private future: string[] = [];
  private poseEditor = new PoseEditor({
    onPreview: (m) => window.setOverrideMorphs(m),
    onChange: (file) => this.onConfigEdited(file),
    onSave: (file) => void this.saveConfig(file),
  });
  private envItems?: CheckItem[];
  private models: string[] = [];
  private els!: {
    projectSelect: HTMLSelectElement;
    chips: HTMLElement;
    stageBox: HTMLElement;
    stageInfo: HTMLElement;
    playBtn: HTMLButtonElement;
    time: HTMLElement;
    seek: HTMLInputElement;
    loop: HTMLInputElement;
    panels: Record<Tab, HTMLElement>;
    tabs: Record<Tab, HTMLButtonElement>;
    toasts: HTMLElement;
  };

  constructor(private readonly player: PlayerLike, private readonly mode: "studio" | "demo") {}

  // ---------------------------------------------------------------- démarrage
  async start(demoPayload?: ProjectPayload): Promise<void> {
    document.body.classList.add("ui");
    this.buildShell();
    this.timeline = new Timeline(document.getElementById("timeline-container")!, {
      onSeek: (t) => this.seekTo(t),
      onSelect: () => {
        this.renderPanel("pistes");
        if (this.timeline.selection) this.showTab("pistes");
      },
      onChange: () => this.onPerfEdited(),
    });
    this.timeline.beforeChange = () => this.pushHistory();
    window.addEventListener("resize", () => this.fit());
    document.addEventListener("keydown", (e) => this.onKey(e));
    requestAnimationFrame(() => this.tick());

    if (this.mode === "demo") {
      if (demoPayload) await this.setPayload(demoPayload, "Démo");
      this.renderAll();
      return;
    }
    try {
      await this.loadProjects();
      const wanted = new URLSearchParams(location.search).get("project") ?? this.current;
      if (wanted) await this.openProject(wanted);
      this.listenChanges();
      void this.refreshJobs();
      void api.check().then((r) => {
        this.envItems = r.items;
        this.models = r.models;
        const missing = r.items.filter((i) => !i.ok && ["ffmpeg", "chrome", "player"].includes(i.id));
        if (missing.length) this.toast(`Outils manquants : ${missing.map((m) => m.label).join(", ")} (onglet Journal → Environnement)`, "warn", 8000);
      }).catch(() => undefined);
    } catch (e) {
      this.toast(`Impossible de joindre le serveur du studio : ${(e as Error).message}`, "err");
    }
    this.renderAll();
  }

  private buildShell(): void {
    const root = document.getElementById("app")!;
    clear(root);
    const projectSelect = h("select", { title: "Projet", onchange: () => void this.openProject(projectSelect.value) });
    const chips = h("div.row", { style: { margin: "0" } });
    const themeBtn = h("button.icon", { title: "Thème clair / sombre", onclick: () => this.toggleTheme() }, icon("moon"));
    const topbar = h(
      "header.topbar",
      null,
      h("div.brand", null, h("span.dot"), "Avatar Studio", h("span.chip", null, this.mode === "demo" ? "démo GitHub Pages" : "local")),
      this.mode === "studio" ? projectSelect : null,
      this.mode === "studio" ? h("button", { title: "Nouveau projet", onclick: () => void this.newProject() }, icon("plus"), "Projet") : null,
      h("div.spacer"),
      chips,
      themeBtn,
    );
    const viewport = document.getElementById("viewport")!;
    const stageBox = h("div.stage-box", null, viewport);
    const stageInfo = h("div.stage-info", null, "");
    const stageWrap = h("div.stage-wrap", null, stageBox, stageInfo);
    const playBtn = h("button.primary", { title: "Lecture / pause (espace)", onclick: () => this.toggle() }, icon("play"), "Lecture");
    const time = h("span.time", null, "0:00.00 / 0:00.00");
    const seek = h("input", { type: "range", min: 0, max: 1000, value: 0, title: "Position" });
    seek.addEventListener("input", () => this.seekTo((Number(seek.value) / 1000) * (this.perf?.duration ?? 0)));
    const loop = h("input", { type: "checkbox", checked: true });
    const transport = h(
      "div.transport",
      null,
      h("button.icon", { title: "Début (Home)", onclick: () => this.seekTo(0) }, icon("prev")),
      playBtn,
      h("button.icon", { title: "Image précédente (←)", onclick: () => this.step(-1) }, icon("stop")),
      h("button.icon", { title: "Image suivante (→)", onclick: () => this.step(1) }, icon("next")),
      time,
      seek,
      h("label", { title: "Lecture en boucle" }, loop, " boucle"),
    );
    const tlTools = h(
      "div.timeline-tools",
      null,
      h("span", null, "Timeline : clic = aller à, glisser = déplacer, double-clic = ajouter, ", h("kbd", null, "Suppr"), " = supprimer, ", h("kbd", null, "Ctrl"), " + molette = zoom"),
      h("div.spacer"),
      h("button.icon.small", { title: "Zoom avant", onclick: () => this.timeline.zoom(1.5) }, icon("zoomIn", 16)),
      h("button.icon.small", { title: "Zoom arrière", onclick: () => this.timeline.zoom(1 / 1.5) }, icon("zoomOut", 16)),
      h("button.small", { title: "Tout afficher", onclick: () => this.timeline.fit() }, "Ajuster"),
    );
    const tlWrap = h("div.timeline-wrap", null, tlTools, h("div.timeline-container#timeline-container"));
    const tabs = {} as Record<Tab, HTMLButtonElement>;
    const panels = {} as Record<Tab, HTMLElement>;
    const nav = h("nav.tabs");
    const panelWrap = h("div.panels", { style: { display: "contents" } });
    for (const t of TABS) {
      tabs[t.id] = h("button", { onclick: () => this.showTab(t.id) }, t.label);
      nav.appendChild(tabs[t.id]);
      panels[t.id] = h("section.panel", { dataset: { tab: t.id } });
      panelWrap.appendChild(panels[t.id]);
    }
    const side = h("aside.side", null, nav, panelWrap);
    const toasts = h("div.toasts");
    root.append(topbar, h("main.layout", null, h("section.left", null, stageWrap, transport, tlWrap), side), toasts);
    this.els = { projectSelect, chips, stageBox, stageInfo, playBtn, time, seek, loop, panels, tabs, toasts };
    this.showTab(this.tab);
    const saved = localStorage.getItem("avatar-theme");
    if (saved) document.documentElement.dataset.theme = saved;
  }

  private toggleTheme(): void {
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const current = document.documentElement.dataset.theme ?? (dark ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("avatar-theme", next);
    this.timeline.draw();
  }

  toast(message: string, kind: "info" | "ok" | "warn" | "err" = "info", ms = 5000): void {
    const el = h(`div.toast.${kind}`, null, message);
    this.els.toasts.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  private showTab(tab: Tab): void {
    if (this.tab === "poses" && tab !== "poses") this.poseEditor.stopPreview();
    this.tab = tab;
    for (const t of TABS) {
      this.els.tabs[t.id].classList.toggle("active", t.id === tab);
      this.els.panels[t.id].classList.toggle("active", t.id === tab);
    }
    this.renderPanel(tab);
  }

  // ---------------------------------------------------------------- projets
  private async loadProjects(): Promise<void> {
    const r = await api.projects();
    this.projects = r.projects;
    this.current ??= r.current;
    const sel = this.els.projectSelect;
    clear(sel);
    if (!this.projects.length) sel.appendChild(h("option", { value: "" }, "(aucun projet)"));
    for (const p of this.projects) sel.appendChild(h("option", { value: p.name, selected: p.name === this.current }, `${p.name}${p.hasPerformance ? "" : " (à préparer)"}`));
  }

  private async newProject(): Promise<void> {
    const name = prompt("Nom du nouveau projet (lettres, chiffres, tirets) :", "");
    if (!name) return;
    try {
      const s = await api.createProject(name);
      await this.loadProjects();
      await this.openProject(s.name);
      this.showTab("projet");
      this.toast(`Projet « ${s.name} » créé. Ajoutez un audio ou un texte puis préparez.`, "ok");
    } catch (e) {
      this.toast((e as Error).message, "err");
    }
  }

  async openProject(name: string): Promise<void> {
    if (!name) return;
    this.pause();
    this.current = name;
    this.els.projectSelect.value = name;
    this.dirtyPerf = false;
    this.timeline.select(null);
    try {
      const p = await api.project(name);
      this.summary = p.summary;
      await this.setPayload(p, name);
      const url = new URL(location.href);
      url.searchParams.set("project", name);
      history.replaceState(null, "", url);
    } catch (e) {
      // projet sans performance.json : on garde la config, on affiche l'onglet projet
      this.summary = this.projects.find((p) => p.name === name);
      this.perf = undefined;
      this.timeline.setData(undefined as never, undefined as never);
      if (!/lancez d'abord/.test((e as Error).message)) this.toast((e as Error).message, "err", 8000);
      this.showTab("projet");
    }
    this.renderAll();
  }

  private async setPayload(p: ProjectPayload & { name?: string; summary?: ProjectSummary }, label: string): Promise<void> {
    this.payload = p;
    this.perf = normalizePerformance(validatePerformance(JSON.parse(JSON.stringify(p.performance))));
    this.cfg = p.config;
    this.dirtyPerf = false;
    if (p.summary) this.summary = p.summary;
    this.els.stageInfo.textContent = "chargement du modèle…";
    try {
      const report = await this.player.load({ ...p, performance: this.perf, config: this.cfg });
      this.els.stageInfo.textContent = `${label} · ${p.config.scene.resolution.width}×${p.config.scene.resolution.height} · ${this.perf.fps} i/s · ${report.software ? "WebGL logiciel" : "WebGL"}`;
      if (report.warnings.length) this.toast(`${report.warnings.length} avertissement(s) au chargement (onglet Projet → Modèle)`, "warn");
    } catch (e) {
      this.els.stageInfo.textContent = `erreur : ${(e as Error).message}`;
      this.toast((e as Error).message, "err", 10000);
    }
    this.setAudio(p.audioUrl);
    this.timeline.setData(this.perf, this.cfg);
    this.fit();
    this.seekTo(Math.min(this.t, this.perf.duration));
  }

  private setAudio(url?: string): void {
    if (this.audioUrl === url) return;
    this.audio?.pause();
    this.audio = undefined;
    this.audioUrl = url;
    if (url) {
      this.audio = new Audio(url);
      this.audio.preload = "auto";
    }
  }

  private listenChanges(): void {
    const es = new EventSource("/events");
    es.addEventListener("change", async (e) => {
      const { what, project } = JSON.parse((e as MessageEvent).data) as { what: string; project?: string };
      if (what.startsWith("config/")) {
        try {
          const r = await api.config();
          this.cfg = r.config;
          this.dirtyConfig.clear();
          this.scheduleApply();
          this.renderPanel("reglages");
          this.toast(`${what} rechargé`, "info", 2500);
        } catch (err) {
          this.toast((err as Error).message, "err");
        }
      } else if (project && project === this.current && !this.dirtyPerf) {
        try {
          const p = await api.project(project);
          const keepT = this.t;
          await this.setPayload(p, project);
          this.seekTo(keepT);
          this.toast("performance.json rechargé", "info", 2500);
          this.renderAll();
        } catch (err) {
          this.toast((err as Error).message, "err");
        }
      }
    });
  }

  // ---------------------------------------------------------------- lecture
  private fit(): void {
    if (!this.cfg) return;
    const { width, height } = this.cfg.scene.resolution;
    const wrap = this.els.stageBox.parentElement!;
    const scale = Math.min(1, (wrap.clientWidth - 28) / width, (wrap.clientHeight - 28) / height);
    const viewport = document.getElementById("viewport")!;
    viewport.style.transform = `scale(${scale})`;
    this.els.stageBox.style.width = `${width * scale}px`;
    this.els.stageBox.style.height = `${height * scale}px`;
  }

  private toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  private play(): void {
    if (!this.perf) return;
    if (this.t >= this.perf.duration - 0.01) this.t = 0;
    this.playing = true;
    clear(this.els.playBtn);
    this.els.playBtn.append(icon("pause"), "Pause");
    if (this.audio) {
      this.audio.currentTime = this.t;
      void this.audio.play().catch(() => undefined);
    }
    this.clockStart = performance.now();
    this.clockOffset = this.t;
  }

  private pause(): void {
    this.playing = false;
    clear(this.els.playBtn);
    this.els.playBtn.append(icon("play"), "Lecture");
    this.audio?.pause();
  }

  private seekTo(t: number): void {
    const D = this.perf?.duration ?? 0;
    this.t = Math.max(0, Math.min(D, t));
    if (this.audio) this.audio.currentTime = this.t;
    this.clockStart = performance.now();
    this.clockOffset = this.t;
    this.lastFrame = -1;
  }

  private step(frames: number): void {
    if (!this.perf) return;
    this.pause();
    const f = Math.round(this.t * this.perf.fps) + frames;
    this.seekTo(f / this.perf.fps);
  }

  private tick(): void {
    requestAnimationFrame(() => this.tick());
    const perf = this.perf;
    if (!perf) return;
    if (this.playing) {
      const audioOk = this.audio && !this.audio.paused && !this.audio.ended && this.audio.readyState >= 2;
      this.t = audioOk ? this.audio!.currentTime : this.clockOffset + (performance.now() - this.clockStart) / 1000;
      if (this.t >= perf.duration) {
        if (this.els.loop.checked) this.seekTo(0);
        else {
          this.t = perf.duration;
          this.pause();
        }
      }
    }
    const frame = Math.floor(this.t * perf.fps + 1e-6);
    if (frame !== this.lastFrame) {
      this.lastFrame = frame;
      void this.player.renderFrame(frame / perf.fps).catch(() => undefined);
      this.els.time.textContent = `${fmtTime(frame / perf.fps)} / ${fmtTime(perf.duration)}`;
      this.els.seek.value = String(Math.round((this.t / Math.max(0.001, perf.duration)) * 1000));
      this.timeline.setTime(this.t);
    }
  }

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
    if (e.code === "Space") {
      e.preventDefault();
      this.toggle();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (e.shiftKey) this.seekTo(this.t - 1);
      else this.step(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (e.shiftKey) this.seekTo(this.t + 1);
      else this.step(1);
    } else if (e.key === "Home") this.seekTo(0);
    else if (e.key === "End") this.seekTo(this.perf?.duration ?? 0);
    else if (e.key === "Delete" || e.key === "Backspace") {
      if (this.timeline.deleteSelection()) e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void this.saveAll();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      this.redo();
    }
  }

  // ---------------------------------------------------------------- édition
  /** Ré-applique performance + config au player (prochaine image), sans recharger le modèle. */
  private scheduleApply(): void {
    if (this.applyScheduled || !this.payload || !this.perf || !this.cfg) return;
    this.applyScheduled = true;
    requestAnimationFrame(async () => {
      this.applyScheduled = false;
      try {
        await this.player.load({ ...this.payload!, performance: this.perf!, config: this.cfg! });
        this.fit();
        this.lastFrame = -1;
      } catch (e) {
        this.toast((e as Error).message, "err");
      }
    });
  }

  /** Instantané des pistes pour annuler (appelé avant une modification). */
  pushHistory(): void {
    if (!this.perf) return;
    const snap = JSON.stringify({ expressions: this.perf.expressions, gestures: this.perf.gestures });
    if (this.history[this.history.length - 1] === snap) return;
    this.history.push(snap);
    if (this.history.length > 100) this.history.shift();
    this.future = [];
  }

  private restore(snap: string): void {
    if (!this.perf) return;
    const data = JSON.parse(snap) as { expressions: ExpressionSegment[]; gestures: GestureEvent[] };
    this.perf.expressions = data.expressions;
    this.perf.gestures = data.gestures;
    this.timeline.select(null);
    this.onPerfEdited(true);
    this.renderPanel("pistes");
  }

  undo(): void {
    if (!this.perf || !this.history.length) return;
    this.future.push(JSON.stringify({ expressions: this.perf.expressions, gestures: this.perf.gestures }));
    this.restore(this.history.pop()!);
  }

  redo(): void {
    if (!this.perf || !this.future.length) return;
    this.history.push(JSON.stringify({ expressions: this.perf.expressions, gestures: this.perf.gestures }));
    this.restore(this.future.pop()!);
  }

  private onPerfEdited(fromHistory = false): void {
    if (!this.perf) return;
    void fromHistory;
    this.dirtyPerf = true;
    this.perf.expressions.sort((a, b) => a.start - b.start);
    this.perf.gestures.sort((a, b) => a.at - b.at);
    this.scheduleApply();
    this.timeline.setData(this.perf, this.cfg!);
    this.renderChips();
    if (this.mode === "studio") {
      clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => void this.savePerf(), 900);
    }
  }

  private async savePerf(): Promise<void> {
    if (!this.perf || !this.current || this.mode !== "studio") return;
    try {
      await api.savePerformance(this.current, this.perf);
      this.dirtyPerf = false;
      this.renderChips();
    } catch (e) {
      this.toast(`Enregistrement de performance.json refusé : ${(e as Error).message}`, "err", 8000);
    }
  }

  /** Joue un geste à la position courante sans l'enregistrer dans les pistes. */
  private testGesture(clip: string): void {
    if (!this.perf || !this.payload || !this.cfg) return;
    const perf = JSON.parse(JSON.stringify(this.perf)) as Performance;
    perf.gestures.push({ at: round(this.t), clip, source: "test" });
    const duration = this.cfg.gestures.procedural[clip]?.duration ?? 1.5;
    void this.player.load({ ...this.payload, performance: perf, config: this.cfg }).then(() => {
      this.lastFrame = -1;
      this.play();
      const stopAt = this.t + duration + 0.4;
      const check = () => {
        if (this.t >= stopAt || !this.playing) {
          this.pause();
          this.scheduleApply();
        } else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }

  private onConfigEdited(file: keyof AllConfig): void {
    this.dirtyConfig.add(file);
    this.scheduleApply();
    this.timeline.setData(this.perf!, this.cfg!);
    this.renderChips();
  }

  private async saveConfig(file: keyof AllConfig): Promise<void> {
    if (!this.cfg) return;
    if (this.mode === "demo") {
      download(`${file}.json`, JSON.stringify(this.cfg[file], null, 2));
      this.dirtyConfig.delete(file);
      this.renderChips();
      return;
    }
    try {
      await api.saveConfig(file, this.cfg[file]);
      this.dirtyConfig.delete(file);
      this.renderChips();
      this.renderPanel("reglages");
      this.toast(`config/${file}.json enregistré`, "ok", 2500);
    } catch (e) {
      this.toast((e as Error).message, "err");
    }
  }

  private async saveAll(): Promise<void> {
    if (this.dirtyPerf) {
      if (this.mode === "demo" && this.perf) download("performance.json", JSON.stringify(this.perf, null, 2));
      else await this.savePerf();
    }
    for (const f of [...this.dirtyConfig]) await this.saveConfig(f);
    this.toast("Tout est enregistré", "ok", 2000);
  }

  // ---------------------------------------------------------------- jobs
  private async refreshJobs(): Promise<void> {
    try {
      this.jobs = (await api.jobs()).jobs;
      this.renderPanel("journal");
      this.renderPanel("rendu");
    } catch {
      /* hors ligne */
    }
  }

  private async runJob(type: JobSummary["type"], options: Record<string, unknown>): Promise<void> {
    if (!this.current) return;
    if (this.busy) {
      this.toast("Un job est déjà en cours ; il sera exécuté à la suite.", "info");
    }
    try {
      const job = await api.startJob(type, this.current, options);
      this.jobs.unshift(job);
      this.activeJobId = job.id;
      this.jobLogs.set(job.id, []);
      this.busy = true;
      this.showTab("journal");
      const status = await api.followJob(job.id, (ev) => {
        const list = this.jobLogs.get(job.id)!;
        list.push(ev);
        const j = this.jobs.find((x) => x.id === job.id);
        if (j) {
          if (ev.type === "progress" && ev.done !== undefined && ev.total !== undefined) j.progress = { done: ev.done, total: ev.total };
          if (ev.type === "status" && ev.status) {
            j.status = ev.status;
            if (ev.result) j.result = ev.result;
            if (ev.message) j.error = ev.message;
          }
        }
        if (this.tab === "journal") this.renderJournalLive(job.id);
        else if (this.tab === "rendu" && ev.type === "progress") this.renderPanel("rendu");
      });
      this.busy = false;
      const label = JOB_LABELS[type];
      if (status === "termine") {
        this.toast(`${label} terminé`, "ok");
        if (type === "prepare") await this.openProject(this.current);
        else {
          const p = await api.project(this.current).catch(() => undefined);
          if (p) this.summary = p.summary;
        }
      } else this.toast(`${label} : ${status}${this.jobs.find((x) => x.id === job.id)?.error ? " — " + this.jobs.find((x) => x.id === job.id)!.error : ""}`, status === "annule" ? "warn" : "err", 10000);
      this.renderAll();
    } catch (e) {
      this.busy = false;
      this.toast((e as Error).message, "err");
    }
  }

  // ---------------------------------------------------------------- rendu des panneaux
  private renderAll(): void {
    this.renderChips();
    for (const t of TABS) this.renderPanel(t.id);
  }

  private renderChips(): void {
    const c = this.els.chips;
    clear(c);
    if (this.dirtyPerf) c.appendChild(h("span.chip.warn", null, this.mode === "demo" ? "pistes modifiées (non enregistrées)" : "pistes : enregistrement…"));
    if (this.dirtyConfig.size) c.appendChild(h("span.chip.warn", null, `réglages modifiés : ${[...this.dirtyConfig].join(", ")}`));
    if (this.dirtyPerf || this.dirtyConfig.size) c.appendChild(h("button.small", { onclick: () => void this.saveAll() }, icon("save", 14), this.mode === "demo" ? "Télécharger" : "Tout enregistrer"));
    if (this.busy) c.appendChild(h("span.chip", null, "job en cours…"));
  }

  private renderPanel(tab: Tab): void {
    const el = this.els.panels[tab];
    if (!el.classList.contains("active")) return;
    clear(el);
    switch (tab) {
      case "projet":
        this.renderProjet(el);
        break;
      case "pistes":
        this.renderPistes(el);
        break;
      case "reglages":
        this.renderReglages(el);
        break;
      case "poses":
        if (this.cfg) this.poseEditor.render(el, this.cfg);
        else el.append(h("div.empty", null, "Chargement de la configuration…"));
        break;
      case "rendu":
        this.renderRendu(el);
        break;
      case "journal":
        this.renderJournal(el);
        break;
    }
  }

  private renderProjet(el: HTMLElement): void {
    if (this.mode === "demo") {
      el.append(
        h("h3", null, "Démonstration"),
        h("p", null, "Cette page publiée sur GitHub Pages montre le player. La chaîne complète (voix, Rhubarb, Whisper, Azure, rendu vidéo) tourne sur votre machine avec ", h("code", null, "avatar studio"), "."),
        this.dropZone(),
        h("p.hint", null, "Déposez un .glb pour changer de personnage, un performance.json et son audio.wav produits par la CLI pour les rejouer ici."),
      );
      this.renderModelReport(el);
      return;
    }
    const s = this.summary;
    if (!this.current) {
      el.append(h("div.empty", null, "Créez un projet avec le bouton « + Projet » pour commencer."));
      return;
    }
    el.append(h("div.row", null, h("h3", { style: { margin: "4px 0", flex: 1 } }, `Projet « ${this.current} »`), h("button.small.danger", { title: "Supprimer le projet et tous ses fichiers", onclick: async () => {
      if (!this.current || !confirm(`Supprimer définitivement le projet « ${this.current} » et ses fichiers ?`)) return;
      try {
        await api.deleteProject(this.current);
        this.current = undefined;
        this.perf = undefined;
        await this.loadProjects();
        if (this.current) await this.openProject(this.current);
        this.renderAll();
        this.toast("Projet supprimé", "ok");
      } catch (e) {
        this.toast((e as Error).message, "err");
      }
    } }, icon("trash", 14), "Supprimer")));
    const dl = h("dl.kv");
    if (s?.meta) dl.append(h("dt", null, "Mode"), h("dd", null, s.meta.mode === "texte" ? "B : texte → voix Azure" : "A : voix enregistrée"));
    if (this.perf) {
      dl.append(h("dt", null, "Durée"), h("dd", null, `${this.perf.duration.toFixed(2)} s à ${this.perf.fps} i/s`));
      dl.append(h("dt", null, "Mots"), h("dd", null, `${this.perf.words.length} · ${this.perf.visemes.length} visèmes · ${this.perf.expressions.length} émotions · ${this.perf.gestures.length} gestes`));
      dl.append(h("dt", null, "Texte"), h("dd", { style: { maxHeight: "72px", overflow: "auto", color: "var(--muted)" } }, this.perf.text));
    } else dl.append(h("dt", null, "État"), h("dd", null, "pas encore préparé"));
    el.append(dl);

    el.append(h("h3", null, "Source"));
    const fileInput = h("input", { type: "file", accept: ".mp3,.wav,.m4a,.ogg,.flac,.txt,.md", style: { display: "none" } });
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files?.[0];
      if (!f || !this.current) return;
      try {
        const r = await api.upload(this.current, f);
        this.prepareInput = { kind: r.kind, file: r.name };
        const p = await api.projects();
        this.projects = p.projects;
        this.summary = this.projects.find((x) => x.name === this.current) ?? this.summary;
        this.toast(`${r.name} ajouté (${fmtBytes(r.size)})`, "ok");
        this.renderPanel("projet");
      } catch (e) {
        this.toast((e as Error).message, "err");
      }
    });
    const sources = s?.sources ?? [];
    if (!this.prepareInput && sources.length) {
      const last = sources[sources.length - 1];
      this.prepareInput = { kind: /\.(txt|md)$/i.test(last) ? "texte" : "audio", file: last };
    }
    const list = h("div.list");
    for (const src of sources) {
      const kind = /\.(txt|md)$/i.test(src) ? "texte" : "audio";
      list.appendChild(
        h(
          "div.item",
          { className: `item${this.prepareInput?.file === src ? " selected" : ""}`, onclick: () => { this.prepareInput = { kind, file: src }; this.renderPanel("projet"); } },
          icon(kind === "texte" ? "info" : "film", 14),
          h("span.grow", null, src),
          h("span.meta", null, kind === "texte" ? "mode B" : "mode A"),
        ),
      );
    }
    if (!sources.length) list.appendChild(h("p.hint", null, "Aucun fichier source. Ajoutez un enregistrement de voix (mp3, wav…) ou un script texte (txt) avec des balises [émotion] et [geste:nom]."));
    el.append(list, h("div.row", null, h("button", { onclick: () => fileInput.click() }, icon("upload"), "Ajouter un audio ou un texte"), fileInput));

    el.append(h("h3", null, "Préparation"));
    const sansLlm = h("input", { type: "checkbox" });
    const force = h("input", { type: "checkbox" });
    el.append(
      h("div.stack", null, h("label", null, sansLlm, " sans annotation LLM (expressions et gestes procéduraux + balises)"), h("label", null, force, " ignorer le cache et tout recalculer")),
      h(
        "div.row",
        null,
        h("button.primary", { disabled: !this.prepareInput || this.busy, onclick: () => this.prepareInput && void this.runJob("prepare", { ...this.prepareInput, sansLlm: sansLlm.checked, force: force.checked }) }, icon("play"), this.perf ? "Préparer à nouveau" : "Préparer"),
        this.prepareInput ? h("span.meta", { style: { color: "var(--muted)" } }, `→ ${this.prepareInput.file}`) : null,
      ),
      h("p.hint", null, "Normalisation, transcription Whisper, Rhubarb, énergie, annotation. Les étapes inchangées sont lues depuis le cache."),
    );

    if (this.perf && s?.meta?.mode === "audio") {
      el.append(h("h3", null, "Transcription"));
      const ta = h("textarea", { placeholder: "chargement…" });
      void api.transcript(this.current).then((r) => (ta.value = r.transcript ?? ""));
      el.append(
        ta,
        h("div.row", null, h("button", { onclick: async () => {
          if (!this.current) return;
          try {
            await api.saveTranscript(this.current, ta.value);
            this.toast("transcript.txt enregistré : relancez la préparation pour réaligner", "ok");
          } catch (e) {
            this.toast((e as Error).message, "err");
          }
        } }, icon("save"), "Enregistrer la correction")),
        h("p.hint", null, "Corrigez les mots mal reconnus puis préparez à nouveau : seuls l'alignement et l'annotation sont recalculés."),
      );
    }
    this.renderModelReport(el);
  }

  private renderModelReport(el: HTMLElement): void {
    const r = this.player.report;
    if (!r) return;
    const lines = [
      `modèle : ${r.model}`,
      `WebGL : ${r.renderer}${r.software ? " (logiciel)" : ""}`,
      `blendshapes ARKit : ${r.blendshapesFound.length}/52 sur ${r.meshesWithMorphs} maillage(s)`,
      r.blendshapesMissing.length ? `manquants : ${r.blendshapesMissing.join(", ")}` : "",
      `os résolus : ${Object.keys(r.bonesFound).length}${r.bonesMissing.length ? ` (manquants : ${r.bonesMissing.join(", ")})` : ""}`,
      `animations : ${r.animations.length ? r.animations.join(" ; ") : "aucune"} · gestes : ${r.gestureSource}`,
      ...r.warnings.map((w) => `⚠ ${w}`),
    ].filter(Boolean);
    el.append(h("details.section", null, h("summary", null, "Modèle et blendshapes", r.warnings.length ? h("span.chip.warn.dirty", null, `${r.warnings.length}`) : null), h("div.body", null, h("div.report", null, lines.join("\n")))));
  }

  private dropZone(): HTMLElement {
    const zone = h("div.drop", null, "Déposez ici un modèle .glb, un performance.json et/ou un fichier audio (ou cliquez).");
    const handle = async (files: FileList) => {
      const payload = { ...(this.payload as ProjectPayload) };
      let perf: Performance | undefined;
      for (const f of Array.from(files)) {
        const n = f.name.toLowerCase();
        if (n.endsWith(".glb") || n.endsWith(".gltf")) payload.modelUrl = URL.createObjectURL(f);
        else if (n.endsWith(".json")) {
          try {
            perf = validatePerformance(JSON.parse(await f.text()));
          } catch (e) {
            this.toast(`performance.json refusé : ${(e as Error).message}`, "err", 10000);
            return;
          }
        } else if (/\.(wav|mp3|m4a|ogg|flac)$/.test(n)) payload.audioUrl = URL.createObjectURL(f);
      }
      if (perf) payload.performance = perf;
      await this.setPayload(payload, "Démo");
      this.renderAll();
    };
    for (const ev of ["dragenter", "dragover"]) zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("over"));
    zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("over"); if (e.dataTransfer?.files.length) void handle(e.dataTransfer.files); });
    zone.addEventListener("click", () => {
      const input = h("input", { type: "file", multiple: true, accept: ".glb,.gltf,.json,.wav,.mp3,.m4a,.ogg" });
      input.onchange = () => input.files && void handle(input.files);
      input.click();
    });
    document.body.addEventListener("dragover", (e) => e.preventDefault());
    document.body.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer?.files.length) void handle(e.dataTransfer.files); });
    return zone;
  }

  private renderPistes(el: HTMLElement): void {
    const perf = this.perf;
    const cfg = this.cfg;
    if (!perf || !cfg) {
      el.append(h("div.empty", null, "Préparez un projet pour éditer ses pistes."));
      return;
    }
    const sel = this.timeline.selection;
    const emotions = Object.keys(cfg.emotions.emotions);
    const clips = Object.keys(cfg.gestures.procedural);
    el.append(h("h3", null, "Sélection"));
    if (!sel) {
      el.append(h("p.hint", null, "Cliquez un segment d'émotion ou un geste dans la timeline. Double-cliquez une ligne vide pour en ajouter un à la position du clic."));
    } else if (sel.kind === "expression") {
      const seg = perf.expressions[sel.index];
      const emo = h("select", null, ...emotions.map((e) => h("option", { value: e, selected: e === seg.emotion }, e)));
      emo.onchange = () => { this.pushHistory(); seg.emotion = emo.value; seg.source = "manuel"; this.onPerfEdited(); };
      const intensity = h("input", { type: "range", min: 0, max: 1, step: 0.05, value: seg.intensity });
      const intOut = h("output", null, `${Math.round(seg.intensity * 100)} %`);
      intensity.onmousedown = () => this.pushHistory();
      intensity.oninput = () => { seg.intensity = Number(intensity.value); seg.source = "manuel"; intOut.textContent = `${Math.round(seg.intensity * 100)} %`; this.onPerfEdited(); };
      const start = h("input", { type: "number", step: 0.05, min: 0, max: perf.duration, value: seg.start });
      const end = h("input", { type: "number", step: 0.05, min: 0, max: perf.duration, value: seg.end });
      start.onchange = () => { this.pushHistory(); seg.start = Math.min(Number(start.value), seg.end - 0.05); seg.source = "manuel"; this.onPerfEdited(); };
      end.onchange = () => { this.pushHistory(); seg.end = Math.max(Number(end.value), seg.start + 0.05); seg.source = "manuel"; this.onPerfEdited(); };
      el.append(
        h("div.controls", null,
          h("label.control", null, h("span", null, "Émotion"), emo),
          h("label.control", null, h("span", null, "Intensité"), h("div.range", null, intensity, intOut)),
          h("label.control", null, h("span", null, "Début (s)"), start),
          h("label.control", null, h("span", null, "Fin (s)"), end),
        ),
        h("div.row", null,
          h("button", { onclick: () => this.seekTo(seg.start) }, icon("play", 14), "Aller au début"),
          h("button.danger", { onclick: () => this.timeline.deleteSelection() }, icon("trash", 14), "Supprimer"),
        ),
        h("p.hint", null, `Source : ${seg.source} · `, h("kbd", null, "Ctrl+Z"), " annuler, ", h("kbd", null, "Ctrl+Y"), " rétablir"),
      );
    } else {
      const g = perf.gestures[sel.index];
      const clip = h("select", null, ...clips.map((c) => h("option", { value: c, selected: c === g.clip }, c)));
      clip.onchange = () => { this.pushHistory(); g.clip = clip.value; g.source = "manuel"; this.onPerfEdited(); };
      const at = h("input", { type: "number", step: 0.05, min: 0, max: perf.duration, value: g.at });
      at.onchange = () => { this.pushHistory(); g.at = Number(at.value); g.source = "manuel"; this.onPerfEdited(); };
      el.append(
        h("div.controls", null, h("label.control", null, h("span", null, "Geste"), clip), h("label.control", null, h("span", null, "Instant (s)"), at)),
        h("div.row", null,
          h("button", { onclick: () => { this.seekTo(g.at); this.play(); } }, icon("play", 14), "Jouer le geste"),
          h("button.danger", { onclick: () => this.timeline.deleteSelection() }, icon("trash", 14), "Supprimer"),
        ),
        h("p.hint", null, `Source : ${g.source}`),
      );
    }

    el.append(h("h3", null, `Émotions (${perf.expressions.length})`));
    const addEmotion = h("button.small", { onclick: () => {
      this.pushHistory();
      const seg: ExpressionSegment = { start: round(this.t), end: round(Math.min(perf.duration, this.t + 2)), emotion: emotions.find((e) => e !== "neutre") ?? "neutre", intensity: 0.8, source: "manuel" };
      perf.expressions.push(seg);
      this.onPerfEdited();
      this.timeline.select({ kind: "expression", index: perf.expressions.indexOf(seg) });
      this.renderPanel("pistes");
    } }, icon("plus", 14), "Ajouter à la tête de lecture");
    const emoList = h("div.list");
    perf.expressions.forEach((e, i) => {
      const selected = sel?.kind === "expression" && sel.index === i;
      emoList.appendChild(h("div.item", { className: `item${selected ? " selected" : ""}`, onclick: () => { this.timeline.select({ kind: "expression", index: i }); this.seekTo(e.start); this.renderPanel("pistes"); } },
        h("span.sw", { style: { background: EMOTION_COLORS[Math.max(0, emotions.indexOf(e.emotion)) % EMOTION_COLORS.length] } }),
        h("span.grow", null, `${e.emotion} · ${Math.round(e.intensity * 100)} %`),
        h("span.meta", null, `${fmtTime(e.start)} → ${fmtTime(e.end)}`)));
    });
    el.append(h("div.row", null, addEmotion), emoList);

    el.append(h("h3", null, `Gestes (${perf.gestures.length})`));
    const addGesture = h("button.small", { onclick: () => {
      this.pushHistory();
      const g: GestureEvent = { at: round(this.t), clip: clips[0] ?? "salut", source: "manuel" };
      perf.gestures.push(g);
      this.onPerfEdited();
      this.timeline.select({ kind: "gesture", index: perf.gestures.indexOf(g) });
      this.renderPanel("pistes");
    } }, icon("plus", 14), "Ajouter à la tête de lecture");
    const gList = h("div.list");
    perf.gestures.forEach((g, i) => {
      const selected = sel?.kind === "gesture" && sel.index === i;
      gList.appendChild(h("div.item", { className: `item${selected ? " selected" : ""}`, onclick: () => { this.timeline.select({ kind: "gesture", index: i }); this.seekTo(g.at); this.renderPanel("pistes"); } },
        h("span.sw", { style: { background: g.source === "balise" ? "#ffcc66" : g.source === "manuel" ? "#b8f0c4" : "#7cc4ff" } }),
        h("span.grow", null, g.clip),
        h("span.meta", null, `${fmtTime(g.at)} · ${g.source}`)));
    });
    el.append(h("div.row", null, addGesture), gList);

    el.append(h("h3", null, "Fichier"));
    el.append(
      h("div.row", null,
        h("button", { onclick: () => this.mode === "demo" ? download("performance.json", JSON.stringify(perf, null, 2)) : void this.savePerf() }, icon("save", 14), this.mode === "demo" ? "Télécharger performance.json" : "Enregistrer maintenant"),
        h("button", { onclick: async () => {
          if (this.mode === "demo" || !this.current) return;
          if (!confirm("Recharger performance.json depuis le disque et perdre les modifications non enregistrées ?")) return;
          this.dirtyPerf = false;
          await this.openProject(this.current);
        } }, "Recharger depuis le disque"),
      ),
      h("p.hint", null, this.mode === "demo" ? "Sur GitHub Pages, les modifications ne sont pas enregistrées : téléchargez le fichier." : "Les modifications sont enregistrées automatiquement dans performance.json (Ctrl+S pour forcer)."),
    );
  }

  private renderReglages(el: HTMLElement): void {
    const cfg = this.cfg;
    if (!cfg) {
      el.append(h("div.empty", null, "Chargement de la configuration…"));
      return;
    }
    el.append(h("p.hint", null, "Chaque réglage s'applique immédiatement à l'image. Enregistrez pour l'écrire dans config/ (utilisé par le rendu)."));
    if (this.mode === "studio") {
      el.append(h("h3", null, "Modèle 3D"));
      const modelSel = h("select", null,
        ...this.models.map((m) => h("option", { value: m, selected: m === cfg.scene.model }, m.replace(/^assets\/models\//, ""))),
        this.models.includes(cfg.scene.model) ? null : h("option", { value: cfg.scene.model, selected: true }, `${cfg.scene.model} (introuvable)`),
      );
      modelSel.onchange = () => {
        cfg.scene.model = modelSel.value;
        this.onConfigEdited("scene");
        void this.saveConfig("scene").then(() => {
          if (this.current) void this.openProject(this.current);
        });
      };
      el.append(h("div.row", null, modelSel), h("p.hint", null, "Fichiers .glb de assets/models/. Le changement est enregistré et le projet rechargé."));
    }
    if (this.perf && this.cfg) {
      el.append(h("h3", null, "Tester un geste ici"));
      el.append(h("div.row", null, ...Object.keys(cfg.gestures.procedural).map((clip) => h("button.small", { onclick: () => this.testGesture(clip) }, clip))));
      el.append(h("p.hint", null, "Joue le geste à la tête de lecture sans l'ajouter aux pistes."));
    }
    el.append(h("h3", null, "Préréglages de format"));
    el.append(h("div.row", null, ...FORMAT_PRESETS.map((p) => h("button.small", { onclick: () => { p.apply(cfg); this.onConfigEdited("scene"); this.renderPanel("reglages"); } }, p.label))));
    const openState = (id: string) => localStorage.getItem(`avatar-sec-${id}`) !== "0";
    for (const spec of SECTIONS) {
      const dirty = this.dirtyConfig.has(spec.file);
      const details = h("details.section", { open: openState(spec.id) });
      details.addEventListener("toggle", () => localStorage.setItem(`avatar-sec-${spec.id}`, details.open ? "1" : "0"));
      const saveBtn = h("button.small", { onclick: (e: Event) => { e.preventDefault(); void this.saveConfig(spec.file); } }, icon("save", 14), this.mode === "demo" ? "Télécharger" : "Enregistrer");
      details.append(
        h("summary", null, spec.title, dirty ? h("span.chip.warn.dirty", null, "modifié") : h("span.dirty", null, ""), saveBtn),
        h("div.body", null, spec.hint ? h("p.hint", null, spec.hint) : null, buildControls(spec, cfg, () => this.onConfigEdited(spec.file))),
      );
      el.append(details);
    }
  }

  private renderRendu(el: HTMLElement): void {
    if (this.mode === "demo") {
      el.append(h("div.empty", null, "Le rendu vidéo se fait en local : ", h("code", null, "avatar studio"), " ou ", h("code", null, "avatar render <projet> --format mp4"), "."));
      return;
    }
    if (!this.perf || !this.current) {
      el.append(h("div.empty", null, "Préparez un projet avant de le rendre."));
      return;
    }
    const perf = this.perf;
    el.append(h("h3", null, "Vidéo"));
    const format = h("select", null, h("option", { value: "mp4" }, "MP4 fond vert (H.264)"), h("option", { value: "prores4444" }, "ProRes 4444 avec transparence (.mov)"), h("option", { value: "webm-alpha" }, "WebM VP9 avec transparence"));
    const draft = h("input", { type: "checkbox" });
    const srt = h("input", { type: "checkbox", checked: true });
    const debut = h("input", { type: "number", min: 0, max: perf.duration, step: 0.1, value: 0 });
    const fin = h("input", { type: "number", min: 0, max: perf.duration, step: 0.1, value: perf.duration });
    const useT = h("button.small", { onclick: () => { debut.value = String(round(this.t)); } }, "← tête de lecture");
    el.append(
      h("div.controls", null,
        h("label.control", null, h("span", null, "Format"), format),
        h("label.control", null, h("span", null, "Début (s)"), h("div.row", { style: { margin: 0 } }, debut, useT)),
        h("label.control", null, h("span", null, "Fin (s)"), fin),
      ),
      h("div.stack", null, h("label", null, draft, " brouillon : demi-résolution, quatre fois plus rapide (sortie-brouillon.*)"), h("label", null, srt, " sous-titres SRT à côté de la vidéo")),
      h("div.row", null,
        h("button.primary", { disabled: this.busy, onclick: () => void this.runJob("render", { format: format.value, brouillon: draft.checked, srt: srt.checked, debut: Number(debut.value), fin: Number(fin.value) }) }, icon("film"), "Rendre la vidéo"),
        h("button", { disabled: this.busy, onclick: () => void this.runJob("render", { format: "mp4", brouillon: true, srt: false, debut: round(this.t), fin: round(Math.min(perf.duration, this.t + 3)) }) }, "Extrait 3 s ici (brouillon)"),
      ),
      h("p.hint", null, `${Math.ceil(perf.duration * perf.fps)} images à ${perf.fps} i/s. Le rendu est hors ligne et déterministe ; comptez de 2 à 30 images par seconde selon la carte graphique.`),
    );
    const running = this.jobs.find((j) => j.status === "en_cours" && j.type === "render");
    if (running?.progress) {
      const pct = Math.round((running.progress.done / running.progress.total) * 100);
      el.append(h("div.row", null, h("div.progress", { style: { flex: 1 } }, h("div", { style: { width: `${pct}%` } })), h("span.meta", null, `${running.progress.done}/${running.progress.total}`), h("button.small.danger", { onclick: () => void api.cancelJob(running.id) }, "Annuler")));
    }

    el.append(h("h3", null, "Image fixe"));
    const transparentImg = h("input", { type: "checkbox" });
    el.append(
      h("div.row", null,
        h("button", { disabled: this.busy, onclick: () => void this.runJob("image", { t: round(this.t), transparent: transparentImg.checked }) }, icon("camera"), `PNG de l'image à ${fmtTime(this.t)}`),
        h("label", null, transparentImg, " fond transparent"),
      ),
      h("p.hint", null, "Capture exacte du rendu final (bulle comprise) à la position de la tête de lecture."),
    );
    el.append(h("h3", null, "Planche de contrôle"));
    el.append(
      h("div.row", null, h("button", { disabled: this.busy, onclick: () => void this.runJob("planche", { emotions: true }) }, icon("grid"), "Générer la planche (poses et émotions)")),
      h("p.hint", null, "Une image avec la pose de repos, chaque geste à mi-parcours et chaque émotion : pour régler config/gestures.json et emotions.json à l'œil."),
    );

    el.append(h("h3", null, "Fichiers produits"));
    const outputs = this.summary?.outputs ?? [];
    if (!outputs.length) el.append(h("p.hint", null, "Aucun fichier pour l'instant."));
    for (const o of [...outputs].sort((a, b) => b.mtime.localeCompare(a.mtime))) {
      const url = `/files/${encodeURIComponent(this.current)}/${encodeURIComponent(o.name)}`;
      const isVideo = /\.(mp4|webm)$/i.test(o.name);
      const isImage = /\.png$/i.test(o.name);
      const details = h("details.section", null,
        h("summary", null, o.name, h("span.meta.dirty", null, `${fmtBytes(o.size)} · ${new Date(o.mtime).toLocaleString()}`), h("a.btn.small", { href: url, download: o.name, onclick: (e: Event) => e.stopPropagation() }, "Télécharger")),
        h("div.body", null, isVideo ? h("video.preview", { src: `${url}?ts=${o.mtime}`, controls: true, preload: "metadata" }) : isImage ? h("img.preview", { src: `${url}?ts=${o.mtime}`, alt: o.name }) : h("p.hint", null, "Aperçu indisponible pour ce format (ProRes : ouvrez-le dans votre logiciel de montage).")),
      );
      el.append(details);
    }
  }

  private renderJournal(el: HTMLElement): void {
    if (this.mode === "demo") {
      el.append(h("div.empty", null, "Le journal des jobs n'existe qu'en local."));
      return;
    }
    el.append(h("h3", null, "Environnement"));
    if (!this.envItems) {
      el.append(h("p.hint", null, "vérification…"));
      void api.check().then((r) => {
        this.envItems = r.items;
        this.models = r.models;
        if (this.tab === "journal") this.renderPanel("journal");
      }).catch(() => (this.envItems = []));
    } else {
      const list = h("div.list");
      for (const it of this.envItems) {
        list.appendChild(h("div.item", { style: { cursor: "default" }, title: it.impact ? `Nécessaire pour : ${it.impact}` : "" },
          h("span", { style: { color: it.ok ? "var(--ok)" : "var(--warn)" } }, icon(it.ok ? "check" : "warn", 14)),
          h("span.grow", null, it.label),
          h("span.meta", { title: it.detail }, it.detail.length > 42 ? it.detail.slice(0, 40) + "…" : it.detail)));
      }
      el.append(list, h("div.row", null, h("button.small", { onclick: () => { this.envItems = undefined; this.renderPanel("journal"); } }, "Revérifier")));
    }
    el.append(h("h3", null, "Jobs"));
    if (!this.jobs.length) el.append(h("p.hint", null, "Aucun job lancé pour l'instant. Les préparations, rendus et planches apparaîtront ici avec leur journal."));
    const list = h("div.list");
    for (const j of this.jobs.slice(0, 20)) {
      const label = JOB_LABELS[j.type];
      const statusCls = j.status === "termine" ? "ok" : j.status === "erreur" ? "err" : j.status === "en_cours" ? "" : "warn";
      list.appendChild(h("div.item", { className: `item${this.activeJobId === j.id ? " selected" : ""}`, onclick: () => { this.activeJobId = j.id; this.renderPanel("journal"); } },
        h("span.grow", null, `${label} · ${j.project}`),
        j.progress && j.status === "en_cours" ? h("span.meta", null, `${Math.round((j.progress.done / j.progress.total) * 100)} %`) : null,
        h("span.chip", { className: `chip ${statusCls}` }, j.status.replace("_", " ")),
        j.status === "en_cours" || j.status === "en_attente" ? h("button.small.danger", { onclick: (e: Event) => { e.stopPropagation(); void api.cancelJob(j.id); } }, "Annuler") : null,
      ));
    }
    el.append(list);
    const logEl = h("div.log#job-log");
    el.append(h("h3", null, "Journal"), logEl);
    if (this.activeJobId) this.renderJournalLive(this.activeJobId);
  }

  private renderJournalLive(jobId: string): void {
    const logEl = document.getElementById("job-log");
    if (!logEl || this.activeJobId !== jobId) return;
    const events = this.jobLogs.get(jobId);
    if (!events) {
      logEl.textContent = "journal indisponible pour ce job (lancé avant l'ouverture de la page)";
      return;
    }
    clear(logEl);
    for (const ev of events) {
      if (ev.type === "log") logEl.appendChild(h("div", { className: ev.level ?? "info" }, `${ev.at.slice(11, 19)}  ${ev.message ?? ""}`));
      else if (ev.type === "progress") {
        const last = logEl.lastElementChild;
        const text = `           progression : ${ev.done}/${ev.total} images`;
        if (last?.classList.contains("progress-line")) last.textContent = text;
        else logEl.appendChild(h("div.progress-line", null, text));
      } else if (ev.type === "status" && ev.status) {
        logEl.appendChild(h("div", { className: ev.status === "termine" ? "done" : ev.status === "erreur" ? "error" : "warn" }, `${ev.at.slice(11, 19)}  état : ${ev.status}${ev.message ? " — " + ev.message : ""}`));
      }
    }
    logEl.scrollTop = logEl.scrollHeight;
    const j = this.jobs.find((x) => x.id === jobId);
    if (j?.status === "en_cours" && j.progress && this.tab === "journal") {
      /* liste rafraîchie par l'appelant */
    }
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;
