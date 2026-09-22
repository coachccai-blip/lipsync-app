import "./api.js";
import "./ui/style.css";
import * as THREE from "three";
import { createAnimator, makeTestPerformance, mergeConfig, normalizePerformance, validatePerformance, type AllConfig, type Animator, type Performance } from "@avatar/shared";
import { Stage, probeWebGL } from "./scene.js";
import { applyFrame, loadGltf, loadModel, type LoadedModel } from "./model.js";
import { ClipGestureSource } from "./clips.js";
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
  private currentClipsKey = "";
  private lastT = 0;
  /** Poids de blendshapes forcés (éditeur de poses) : remplace bouche, expressions et vie. */
  overrideMorphs?: Record<string, number>;

  async load(payload: ProjectPayload): Promise<LoadReport> {
    const cfg = payload.config;
    const perf = normalizePerformance(validatePerformance(payload.performance));
    const gl = probeWebGL();
    const background = payload.background ?? "green";

    if (!this.stage) this.stage = new Stage(cfg.scene, background);
    else this.stage.applyConfig(cfg.scene, background);

    // modèle : rechargé seulement si l'URL ou la table d'os change
    const modelKey = JSON.stringify([payload.modelUrl ?? null, cfg.bones]);
    if (!this.model || this.currentModelUrl !== payload.modelUrl || this.currentModelCfg !== modelKey) {
      if (this.model) this.stage.scene.remove(this.model.root);
      this.model = await loadModel(payload.modelUrl, cfg.bones, cfg.scene.background.color, cfg.scene.background.greenWarnRatio);
      this.currentModelUrl = payload.modelUrl;
      this.currentModelCfg = modelKey;
      this.currentClipsKey = "";
      this.stage.scene.add(this.model.root);
    }
    this.stage.frame(this.model.box);

    // gestes : clips (modèle ou assets/clips) ou repli procédural
    let gestureSource: "clips" | "procedural" = "procedural";
    const clipWarnings: string[] = [];
    let clipsResolved: string[] = [];
    let clipsMissing: string[] = [];
    if (cfg.gestures.source !== "procedural") {
      const clipsKey = JSON.stringify([payload.clipUrls ?? {}, cfg.gestures.clips, cfg.gestures.idle.clip, perf.gestures]);
      if (this.currentClipsKey !== clipsKey || !this.clips) {
        const external = new Map<string, THREE.AnimationClip[]>();
        for (const [file, url] of Object.entries(payload.clipUrls ?? {})) {
          try {
            external.set(file, (await loadGltf(url)).animations);
          } catch (e) {
            clipWarnings.push(`clip externe ${file} : ${(e as Error).message}`);
          }
        }
        this.clips = new ClipGestureSource(this.model, perf.gestures, cfg.gestures, cfg.bones, external);
        this.currentClipsKey = clipsKey;
      }
      const source = this.clips;
      clipsResolved = source.resolved;
      clipsMissing = source.missing;
      clipWarnings.push(...source.warnings);
      if (source.resolved.length > 0 || cfg.gestures.source === "clips") {
        gestureSource = "clips";
        if (source.missing.length) clipWarnings.push(`gestes sans clip (ignorés) : ${source.missing.join(", ")}`);
      } else {
        this.clips = undefined;
        clipWarnings.push("aucun clip d'animation trouvé : gestes procéduraux (config/gestures.json → procedural)");
      }
    } else this.clips = undefined;
    this.animator = createAnimator(perf, cfg, gestureSource === "clips" ? this.clips : undefined);
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
    await this.renderFrame(this.lastT <= perf.duration ? this.lastT : 0);
    return this.report;
  }

  async renderFrame(t: number): Promise<void> {
    if (!this.stage || !this.model || !this.animator) throw new Error("Aucun projet chargé : appelez loadProject() d'abord.");
    this.lastT = t;
    const frame = this.animator.frameAt(t);
    if (this.overrideMorphs) frame.morphs = { ...this.overrideMorphs };
    applyFrame(this.model, frame, this.clips && this.report?.gestureSource === "clips" ? () => this.clips!.update(t) : undefined);
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
window.setOverrideMorphs = (m) => {
  player.overrideMorphs = m ?? undefined;
};

const params = new URLSearchParams(location.search);
const rawMode = params.get("mode") ?? "demo";
const mode: PlayerMode = rawMode === "preview" ? "studio" : (rawMode as PlayerMode);

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

window.avatarReady = (async () => {
  try {
    if (mode === "render") {
      // piloté par Puppeteer : rien à faire avant loadProject()
      probeWebGL();
      return;
    }
    const { StudioApp } = await import("./ui/app.js");
    const app = new StudioApp(player, mode === "studio" ? "studio" : "demo");
    if (mode === "studio") {
      await app.start();
      return;
    }
    const base = import.meta.env.BASE_URL;
    const cfg = await loadDemoConfig();
    const configured = `${base}${cfg.scene.model.replace(/^\/+/, "")}`;
    const modelUrl = (await urlExists(configured)) ? configured : undefined;
    await app.start({ performance: makeTestPerformance(8, cfg.scene.fps, 12345, true), config: cfg, modelUrl, background: "green" });
  } catch (e) {
    window.__avatarError = (e as Error).message;
    console.error(e);
    throw e;
  }
})();
