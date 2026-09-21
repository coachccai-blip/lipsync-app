import "./api.js";
import * as THREE from "three";
import { createAnimator, makeTestPerformance, mergeConfig, normalizePerformance, validatePerformance, type AllConfig, type Animator, type Performance } from "@avatar/shared";
import { Stage, probeWebGL } from "./scene.js";
import { applyFrame, loadGltf, loadModel, type LoadedModel } from "./model.js";
import { ClipGestureSource } from "./clips.js";
import { PreviewUI } from "./preview.js";
import type { LoadReport, PlayerMode, ProjectPayload } from "./api.js";

/** État du player : scène, modèle, animateur. Une seule instance par page. */
class Player {
  stage?: Stage;
  model?: LoadedModel;
  animator?: Animator;
  clips?: ClipGestureSource;
  perf?: Performance;
  cfg?: AllConfig;
  report?: LoadReport;
  private currentModelUrl?: string;
  private currentModelCfg = "";

  async load(payload: ProjectPayload): Promise<LoadReport> {
    const cfg = payload.config;
    const perf = normalizePerformance(validatePerformance(payload.performance));
    const gl = probeWebGL();
    const background = payload.background ?? "green";

    // scène : recréée si la résolution / la bulle / l'éclairage changent
    const stageKey = JSON.stringify([cfg.scene.resolution, cfg.scene.bubble, cfg.scene.lighting, cfg.scene.background, background]);
    if (!this.stage || this.stage.page.dataset.key !== stageKey) {
      this.stage?.dispose();
      this.stage?.renderer.domElement.remove();
      this.stage = new Stage(cfg.scene, background);
      this.stage.page.dataset.key = stageKey;
      if (this.model) this.stage.scene.add(this.model.root);
    }

    // modèle : rechargé seulement si l'URL ou la table d'os change
    const modelKey = JSON.stringify([payload.modelUrl ?? null, cfg.bones]);
    if (!this.model || this.currentModelUrl !== payload.modelUrl || this.currentModelCfg !== modelKey) {
      if (this.model) this.stage.scene.remove(this.model.root);
      this.model = await loadModel(payload.modelUrl, cfg.bones, cfg.scene.background.color, cfg.scene.background.greenWarnRatio);
      this.currentModelUrl = payload.modelUrl;
      this.currentModelCfg = modelKey;
      this.stage.scene.add(this.model.root);
    }
    this.stage.frame(this.model.box);

    // gestes : clips (modèle ou assets/clips) ou repli procédural
    this.clips = undefined;
    let gestureSource: "clips" | "procedural" = "procedural";
    const clipWarnings: string[] = [];
    let clipsResolved: string[] = [];
    let clipsMissing: string[] = [];
    if (cfg.gestures.source !== "procedural") {
      const external = new Map<string, THREE.AnimationClip[]>();
      for (const [file, url] of Object.entries(payload.clipUrls ?? {})) {
        try {
          external.set(file, (await loadGltf(url)).animations);
        } catch (e) {
          clipWarnings.push(`clip externe ${file} : ${(e as Error).message}`);
        }
      }
      const source = new ClipGestureSource(this.model, perf.gestures, cfg.gestures, cfg.bones, external);
      clipsResolved = source.resolved;
      clipsMissing = source.missing;
      clipWarnings.push(...source.warnings);
      if (source.resolved.length > 0 || cfg.gestures.source === "clips") {
        this.clips = source;
        gestureSource = "clips";
        if (source.missing.length) clipWarnings.push(`gestes sans clip (ignorés) : ${source.missing.join(", ")}`);
      } else {
        clipWarnings.push("aucun clip d'animation trouvé : gestes procéduraux (config/gestures.json → procedural)");
      }
    }
    this.animator = createAnimator(perf, cfg, this.clips);
    this.perf = perf;
    this.cfg = cfg;

    this.report = {
      model: payload.modelUrl ?? "(personnage de substitution)",
      ...this.model.report,
      gestureSource,
      clipsResolved,
      clipsMissing,
      renderer: gl.renderer,
      software: gl.software,
      warnings: [...this.model.report.warnings, ...clipWarnings, ...(gl.software ? ["rendu WebGL logiciel (SwiftShader) : rendu correct mais lent"] : [])],
    };
    await this.renderFrame(0);
    return this.report;
  }

  async renderFrame(t: number): Promise<void> {
    if (!this.stage || !this.model || !this.animator) throw new Error("Aucun projet chargé : appelez loadProject() d'abord.");
    const frame = this.animator.frameAt(t);
    applyFrame(this.model, frame, this.clips ? () => this.clips!.update(t) : undefined);
    this.stage.render();
  }

  getDuration(): number {
    return this.perf?.duration ?? 0;
  }
}

const player = new Player();
window.loadProject = (data) => player.load(data);
window.renderFrame = (t) => player.renderFrame(t);
window.getDuration = () => player.getDuration();
window.getReport = () => player.report;

const params = new URLSearchParams(location.search);
const mode = (params.get("mode") ?? "demo") as PlayerMode;

function formatReport(r: LoadReport): string {
  const lines = [
    `modèle : ${r.model}${r.placeholder ? " — déposez un .glb pour le remplacer" : ""}`,
    `WebGL : ${r.renderer}${r.software ? " (logiciel)" : ""}`,
    `hauteur du modèle : ${r.modelHeight.toFixed(2)} unités`,
    `maillages avec blendshapes : ${r.meshesWithMorphs} ; ARKit trouvés : ${r.blendshapesFound.length}/52`,
    r.blendshapesMissing.length ? `ARKit manquants : ${r.blendshapesMissing.join(", ")}` : "tous les blendshapes ARKit sont présents",
    r.unknownMorphs.length ? `morph targets non ARKit : ${r.unknownMorphs.slice(0, 20).join(", ")}${r.unknownMorphs.length > 20 ? "…" : ""}` : "",
    `os résolus : ${Object.entries(r.bonesFound).map(([k, v]) => `${k}→${v}`).join(", ") || "aucun"}`,
    r.bonesMissing.length ? `os manquants : ${r.bonesMissing.join(", ")}` : "",
    `animations du GLB : ${r.animations.length ? r.animations.join(" ; ") : "aucune"}`,
    `gestes : ${r.gestureSource}${r.clipsResolved.length ? ` (${r.clipsResolved.join(", ")})` : ""}`,
    ...r.warnings.map((w) => `⚠ ${w}`),
  ];
  return lines.filter(Boolean).join("\n");
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function loadDemoConfig(): Promise<AllConfig> {
  const base = import.meta.env.BASE_URL;
  const partial: Record<string, unknown> = {};
  for (const name of ["scene", "visemes", "emotions", "gestures", "bones"]) {
    try {
      partial[name] = await fetchJson(`${base}config/${name}.json`);
    } catch {
      /* valeurs par défaut */
    }
  }
  return mergeConfig(partial);
}

async function urlExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok && !(res.headers.get("content-type") ?? "").includes("text/html");
  } catch {
    return false;
  }
}

async function startPreview(ui: PreviewUI): Promise<void> {
  const reportEl = document.getElementById("report")!;
  const load = async () => {
    ui.status("chargement…");
    const payload = await fetchJson<ProjectPayload>("/api/project");
    const report = await player.load(payload);
    ui.setProject(player.perf!, player.cfg!, payload.audioUrl);
    reportEl.textContent = formatReport(report);
    ui.status(`prêt · ${payload.performance.duration.toFixed(2)} s · ${payload.performance.fps} i/s`);
  };
  await load();
  const events = new EventSource("/events");
  events.addEventListener("change", (e) => {
    ui.status(`rechargement (${(e as MessageEvent).data})…`, "warn");
    load().catch((err) => ui.status(`erreur : ${(err as Error).message}`, "err"));
  });
}

async function startDemo(ui: PreviewUI): Promise<void> {
  const reportEl = document.getElementById("report")!;
  const drop = document.getElementById("drop")!;
  const base = import.meta.env.BASE_URL;
  const cfg = await loadDemoConfig();
  const state: { modelUrl?: string; perf: Performance; audioUrl?: string } = { perf: makeTestPerformance(8, cfg.scene.fps, 12345, true) };
  const configuredModel = `${base}${cfg.scene.model.replace(/^\/+/, "")}`;
  if (await urlExists(configuredModel)) state.modelUrl = configuredModel;

  const load = async () => {
    ui.status("chargement…");
    try {
      const report = await player.load({ performance: state.perf, config: cfg, modelUrl: state.modelUrl, audioUrl: state.audioUrl, background: "green" });
      ui.setProject(player.perf!, player.cfg!, state.audioUrl);
      reportEl.textContent = formatReport(report);
      ui.status(state.modelUrl ? "prêt" : "prêt (personnage de substitution : déposez votre .glb)");
    } catch (e) {
      ui.status(`erreur : ${(e as Error).message}`, "err");
      reportEl.textContent = String((e as Error).stack ?? e);
    }
  };
  await load();

  const onFiles = async (files: FileList) => {
    for (const f of Array.from(files)) {
      const name = f.name.toLowerCase();
      if (name.endsWith(".glb") || name.endsWith(".gltf")) state.modelUrl = URL.createObjectURL(f);
      else if (name.endsWith(".json")) {
        try {
          state.perf = validatePerformance(JSON.parse(await f.text()));
        } catch (e) {
          ui.status(`performance.json refusé : ${(e as Error).message}`, "err");
          return;
        }
      } else if (/\.(wav|mp3|m4a|ogg|flac)$/.test(name)) state.audioUrl = URL.createObjectURL(f);
    }
    await load();
  };
  for (const ev of ["dragenter", "dragover"]) {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("over");
    });
    document.body.addEventListener(ev, (e) => e.preventDefault());
  }
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    drop.classList.remove("over");
    if (e.dataTransfer?.files.length) void onFiles(e.dataTransfer.files);
  };
  drop.addEventListener("drop", onDrop);
  document.body.addEventListener("drop", onDrop);
  drop.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".glb,.gltf,.json,.wav,.mp3,.m4a,.ogg";
    input.onchange = () => input.files && void onFiles(input.files);
    input.click();
  });
}

window.avatarReady = (async () => {
  try {
    if (mode === "render") {
      // piloté par Puppeteer : rien à faire avant loadProject()
      probeWebGL();
      return;
    }
    const ui = new PreviewUI((t) => player.renderFrame(t));
    if (mode === "preview") await startPreview(ui);
    else await startDemo(ui);
  } catch (e) {
    window.__avatarError = (e as Error).message;
    const el = document.getElementById("status");
    if (el) {
      el.textContent = `erreur : ${(e as Error).message}`;
      el.className = "err";
    }
    throw e;
  }
})();
