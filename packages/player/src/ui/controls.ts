import type { AllConfig } from "@avatar/shared";
import { getPath, h, setPath } from "./dom.js";

export interface ControlSpec {
  path: string;
  label: string;
  type: "range" | "number" | "color" | "select" | "checkbox" | "text" | "vec3";
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  hint?: string;
}

export interface SectionSpec {
  id: string;
  title: string;
  /** Fichier de config/ concerné (pour l'enregistrement). */
  file: keyof AllConfig;
  hint?: string;
  controls: ControlSpec[];
}

/** Réglages exposés dans le studio, groupés par fichier de config/. */
export const SECTIONS: SectionSpec[] = [
  {
    id: "format",
    title: "Format et bulle",
    file: "scene",
    hint: "La bulle est découpée en CSS : sa taille et sa position sont exactes au pixel dans la vidéo.",
    controls: [
      { path: "scene.resolution.width", label: "Largeur (px)", type: "number", min: 256, max: 4096, step: 2 },
      { path: "scene.resolution.height", label: "Hauteur (px)", type: "number", min: 256, max: 4096, step: 2 },
      { path: "scene.fps", label: "Cadence (i/s)", type: "select", options: ["24", "25", "30", "50", "60"] },
      { path: "scene.bubble.shape", label: "Forme de la bulle", type: "select", options: ["cercle", "carre"] },
      { path: "scene.bubble.cornerRadius", label: "Rayon des coins du carré (px)", type: "range", min: 0, max: 400, step: 4 },
      { path: "scene.bubble.diameter", label: "Diamètre ou côté (px ou auto)", type: "text" },
      { path: "scene.bubble.margin", label: "Marge (px)", type: "number", min: 0, max: 500, step: 1 },
      { path: "scene.bubble.position.x", label: "Centre X (px ou center)", type: "text" },
      { path: "scene.bubble.position.y", label: "Centre Y (px ou center)", type: "text" },
      { path: "scene.bubble.couleur", label: "Couleur derrière l'avatar (dégradé calculé)", type: "color", hint: "Le dégradé (halo clair derrière la tête, bord plus profond) est calculé à partir de cette teinte." },
      { path: "scene.bubble.fondLibre", label: "Utiliser le CSS libre ci-dessous", type: "checkbox" },
      { path: "scene.bubble.background", label: "Fond de bulle (CSS libre)", type: "text" },
      { path: "scene.bubble.ring.enabled", label: "Anneau", type: "checkbox" },
      { path: "scene.bubble.ring.width", label: "Épaisseur anneau", type: "range", min: 0, max: 60, step: 1 },
      { path: "scene.bubble.ring.color", label: "Couleur anneau", type: "color" },
      { path: "scene.background.color", label: "Fond vert (page)", type: "color" },
      { path: "scene.padding.before", label: "Repos avant (s)", type: "number", min: 0, max: 5, step: 0.1, hint: "appliqué à la prochaine préparation" },
      { path: "scene.padding.after", label: "Repos après (s)", type: "number", min: 0, max: 5, step: 0.1 },
    ],
  },
  {
    id: "marionnette",
    title: "Marionnette 2D",
    file: "scene",
    hint: "Actif quand le modèle est un manifeste marionnette.json (images alignées). Les images sont dans assets/<dossier>/.",
    controls: [
      { path: "scene.marionnette.zoom", label: "Zoom", type: "range", min: 0.5, max: 2, step: 0.01 },
      { path: "scene.marionnette.offsetX", label: "Décalage horizontal", type: "range", min: -0.5, max: 0.5, step: 0.005 },
      { path: "scene.marionnette.offsetY", label: "Décalage vertical", type: "range", min: -0.5, max: 0.5, step: 0.005 },
      { path: "scene.marionnette.motion", label: "Mouvements de tête (px/°)", type: "range", min: 0, max: 8, step: 0.1 },
      { path: "scene.marionnette.breathing", label: "Respiration", type: "range", min: 0, max: 0.03, step: 0.001 },
      { path: "scene.marionnette.mouthEnergy", label: "Étirement de la bouche (énergie)", type: "range", min: 0, max: 0.3, step: 0.01 },
      { path: "scene.marionnette.feather", label: "Adoucissement des bords (px)", type: "range", min: 0, max: 60, step: 1 },
      { path: "scene.marionnette.seuilBruit", label: "Seuil de bruit entre images (0 = tout composer)", type: "range", min: 0, max: 80, step: 1 },
      { path: "scene.marionnette.lissage", label: "Lissage du grain (px)", type: "range", min: 0, max: 3, step: 0.1 },
      { path: "scene.marionnette.suivi", label: "Suivi retardé (cheveux, buste)", type: "range", min: 0, max: 1, step: 0.05 },
      { path: "scene.marionnette.ombre", label: "Ombre de contact", type: "range", min: 0, max: 0.6, step: 0.02 },
      { path: "scene.marionnette.regard", label: "Images de regard (saccades)", type: "checkbox" },
      { path: "scene.marionnette.sourcilsAccent", label: "Sourcils sur accents (seuil, 1 = jamais)", type: "range", min: 0.2, max: 1, step: 0.05 },
      { path: "scene.marionnette.mains", label: "Images de mains (piste gestes)", type: "checkbox" },
      { path: "scene.marionnette.mouthSharpness", label: "Transitions de bouche (4 = bascule nette, jamais deux bouches)", type: "range", min: 1, max: 4, step: 0.1 },
      { path: "scene.marionnette.emotionThreshold", label: "Intensité minimale pour afficher une émotion", type: "range", min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    id: "cadrage",
    title: "Cadrage (modèle 3D)",
    file: "scene",
    controls: [
      { path: "scene.camera.fov", label: "Focale (fov °)", type: "range", min: 10, max: 60, step: 0.5 },
      { path: "scene.camera.bottomRatio", label: "Bas du cadre (fraction de la hauteur)", type: "range", min: 0, max: 0.95, step: 0.01 },
      { path: "scene.camera.marginTop", label: "Marge au-dessus de la tête", type: "range", min: -0.2, max: 0.6, step: 0.01 },
      { path: "scene.camera.distanceScale", label: "Distance (zoom)", type: "range", min: 0.5, max: 2, step: 0.01 },
      { path: "scene.camera.heightOffset", label: "Décalage vertical", type: "range", min: -0.5, max: 0.5, step: 0.01 },
    ],
  },
  {
    id: "lumiere",
    title: "Lumière (modèle 3D)",
    file: "scene",
    hint: "Positions relatives au centre du cadre (x droite, y haut, z vers la caméra).",
    controls: [
      { path: "scene.lighting.exposure", label: "Exposition", type: "range", min: 0.2, max: 3, step: 0.05 },
      { path: "scene.lighting.ambient.intensity", label: "Ambiante", type: "range", min: 0, max: 3, step: 0.05 },
      { path: "scene.lighting.environment.intensity", label: "Environnement", type: "range", min: 0, max: 3, step: 0.05 },
      { path: "scene.lighting.environment.enabled", label: "Environnement actif", type: "checkbox" },
      { path: "scene.lighting.key.intensity", label: "Principale", type: "range", min: 0, max: 8, step: 0.1 },
      { path: "scene.lighting.key.color", label: "Couleur principale", type: "color" },
      { path: "scene.lighting.key.position", label: "Position principale", type: "vec3" },
      { path: "scene.lighting.key.shadows", label: "Ombres", type: "checkbox" },
      { path: "scene.lighting.fill.intensity", label: "Remplissage", type: "range", min: 0, max: 5, step: 0.1 },
      { path: "scene.lighting.fill.color", label: "Couleur remplissage", type: "color" },
      { path: "scene.lighting.fill.position", label: "Position remplissage", type: "vec3" },
      { path: "scene.lighting.rim.intensity", label: "Contre-jour", type: "range", min: 0, max: 5, step: 0.1 },
      { path: "scene.lighting.rim.position", label: "Position contre-jour", type: "vec3" },
      { path: "scene.lighting.eyeCatch.intensity", label: "Accroche des yeux", type: "range", min: 0, max: 3, step: 0.05 },
    ],
  },
  {
    id: "bouche",
    title: "Bouche (lip sync)",
    file: "visemes",
    controls: [
      { path: "visemes.exaggeration", label: "Exagération", type: "range", min: 0.3, max: 2, step: 0.05 },
      { path: "visemes.transitionMs", label: "Transition (ms)", type: "range", min: 20, max: 200, step: 5 },
      { path: "visemes.anticipationMs", label: "Anticipation (ms)", type: "range", min: 0, max: 120, step: 5 },
      { path: "visemes.energyInfluence", label: "Influence de l'énergie", type: "range", min: 0, max: 1, step: 0.05 },
      { path: "visemes.shapes.D.jawOpen", label: "Ouverture max (forme D)", type: "range", min: 0.2, max: 1, step: 0.01 },
      { path: "visemes.shapes.C.jawOpen", label: "Ouverture forme C (È, É)", type: "range", min: 0, max: 1, step: 0.01 },
      { path: "visemes.shapes.E.jawOpen", label: "Ouverture forme E (O)", type: "range", min: 0, max: 1, step: 0.01 },
      { path: "visemes.shapes.F.mouthPucker", label: "Arrondi forme F (OU)", type: "range", min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    id: "expressions",
    title: "Expressions",
    file: "emotions",
    controls: [
      { path: "emotions.fadeMs", label: "Fondu (ms)", type: "range", min: 50, max: 1500, step: 10 },
      { path: "emotions.speechAttenuation", label: "Atténuation bouche pendant la parole", type: "range", min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    id: "vie",
    title: "Vie procédurale",
    file: "scene",
    controls: [
      { path: "scene.life.enabled", label: "Active", type: "checkbox" },
      { path: "scene.life.blink.minInterval", label: "Clignement : intervalle min (s)", type: "range", min: 0.5, max: 10, step: 0.1 },
      { path: "scene.life.blink.maxInterval", label: "Clignement : intervalle max (s)", type: "range", min: 1, max: 15, step: 0.1 },
      { path: "scene.life.blink.duration", label: "Clignement : durée (s)", type: "range", min: 0.06, max: 0.4, step: 0.01 },
      { path: "scene.life.gaze.amplitude", label: "Regard : amplitude", type: "range", min: 0, max: 1, step: 0.01 },
      { path: "scene.life.head.amplitude", label: "Tête : amplitude (°)", type: "range", min: 0, max: 8, step: 0.1 },
      { path: "scene.life.head.speed", label: "Tête : vitesse", type: "range", min: 0.02, max: 0.6, step: 0.01 },
      { path: "scene.life.head.nodOnAccent", label: "Hochement sur accent (°)", type: "range", min: 0, max: 6, step: 0.1 },
      { path: "scene.life.head.tiltOnQuestion", label: "Inclinaison sur les questions (°)", type: "range", min: 0, max: 8, step: 0.5 },
      { path: "scene.life.brows.raiseOnAccent", label: "Sourcils sur accent", type: "range", min: 0, max: 1, step: 0.01 },
      { path: "scene.life.breathing.amplitude", label: "Respiration (°)", type: "range", min: 0, max: 3, step: 0.05 },
    ],
  },
  {
    id: "gestes",
    title: "Gestes",
    file: "gestures",
    hint: "Les images clés se règlent dans config/gestures.json ; vérifiez-les avec la planche (onglet Rendu).",
    controls: [
      { path: "gestures.source", label: "Source", type: "select", options: ["auto", "clips", "procedural"] },
      { path: "gestures.intensity", label: "Amplitude", type: "range", min: 0, max: 2, step: 0.05 },
      { path: "gestures.fadeMs", label: "Fondu (ms)", type: "range", min: 50, max: 1000, step: 10 },
      { path: "gestures.idle.swayAmplitude", label: "Balancement de repos (°)", type: "range", min: 0, max: 5, step: 0.1 },
      { path: "gestures.idle.swayPeriod", label: "Période du balancement (s)", type: "range", min: 2, max: 12, step: 0.1 },
      { path: "gestures.restPose.rightArm", label: "Repos bras droit (°)", type: "vec3" },
      { path: "gestures.restPose.leftArm", label: "Repos bras gauche (°)", type: "vec3" },
      { path: "gestures.restPose.rightForeArm", label: "Repos avant-bras droit (°)", type: "vec3" },
      { path: "gestures.restPose.leftForeArm", label: "Repos avant-bras gauche (°)", type: "vec3" },
    ],
  },
];

/** Construit les contrôles d'une section, liés à `cfg` par chemin ; `onChange` est appelé à chaque modification. */
export function buildControls(spec: SectionSpec, cfg: AllConfig, onChange: (path: string) => void): HTMLElement {
  const wrap = h("div.controls");
  for (const c of spec.controls) {
    const current = getPath(cfg, c.path);
    const id = `ctl-${c.path.replace(/\./g, "-")}`;
    let input: HTMLElement;
    const commit = (value: unknown) => {
      setPath(cfg, c.path, value);
      onChange(c.path);
    };
    switch (c.type) {
      case "range": {
        const out = h("output", null, fmt(current));
        const r = h("input", { type: "range", id, min: c.min, max: c.max, step: c.step, value: Number(current) });
        r.addEventListener("input", () => {
          out.textContent = fmt(Number(r.value));
          commit(Number(r.value));
        });
        input = h("div.range", null, r, out);
        break;
      }
      case "number": {
        const n = h("input", { type: "number", id, min: c.min, max: c.max, step: c.step, value: Number(current) });
        n.addEventListener("change", () => commit(Number(n.value)));
        input = n;
        break;
      }
      case "color": {
        const col = h("input", { type: "color", id, value: toHex(String(current)) });
        col.addEventListener("input", () => commit(col.value));
        input = col;
        break;
      }
      case "select": {
        const sel = h("select", { id }, ...(c.options ?? []).map((o) => h("option", { value: o, selected: String(current) === o }, o)));
        sel.addEventListener("change", () => commit(isNaN(Number(sel.value)) ? sel.value : Number(sel.value)));
        input = sel;
        break;
      }
      case "checkbox": {
        const cb = h("input", { type: "checkbox", id, checked: Boolean(current) });
        cb.addEventListener("change", () => commit(cb.checked));
        input = cb;
        break;
      }
      case "vec3": {
        const arr = Array.isArray(current) ? (current as number[]) : [0, 0, 0];
        const inputs = [0, 1, 2].map((i) => h("input", { type: "number", step: 0.1, value: arr[i] ?? 0, "aria-label": ["x", "y", "z"][i] }));
        for (const n of inputs) n.addEventListener("change", () => commit(inputs.map((x) => Number(x.value) || 0)));
        input = h("div.vec3", null, ...inputs);
        break;
      }
      default: {
        const t = h("input", { type: "text", id, value: String(current ?? "") });
        t.addEventListener("change", () => {
          const v = t.value.trim();
          commit(v === "auto" || v === "center" || v === "" || isNaN(Number(v)) ? v : Number(v));
        });
        input = t;
      }
    }
    wrap.appendChild(h("label.control", { for: id, title: c.hint ?? c.path }, h("span", null, c.label), input));
  }
  return wrap;
}

function fmt(v: unknown): string {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return "#ffffff";
  ctx.fillStyle = color;
  return ctx.fillStyle;
}

/** Préréglages de format : résolution + position de la bulle. */
export const FORMAT_PRESETS: { label: string; apply: (cfg: AllConfig) => void }[] = [
  {
    label: "Carré 1080, bulle ronde",
    apply: (c) => {
      c.scene.resolution = { width: 1080, height: 1080 };
      c.scene.bubble.shape = "cercle";
      c.scene.bubble.diameter = "auto";
      c.scene.bubble.margin = 40;
      c.scene.bubble.position = { x: "center", y: "center" };
    },
  },
  {
    label: "Carré 1080, cadre carré arrondi",
    apply: (c) => {
      c.scene.resolution = { width: 1080, height: 1080 };
      c.scene.bubble.shape = "carre";
      c.scene.bubble.cornerRadius = 96;
      c.scene.bubble.diameter = "auto";
      c.scene.bubble.margin = 40;
      c.scene.bubble.position = { x: "center", y: "center" };
    },
  },
  {
    label: "Paysage, bulle à droite",
    apply: (c) => {
      c.scene.resolution = { width: 1920, height: 1080 };
      c.scene.bubble.diameter = 900;
      c.scene.bubble.margin = 40;
      c.scene.bubble.position = { x: 1920 - 60 - 450, y: "center" };
    },
  },
  {
    label: "Paysage, bulle à gauche",
    apply: (c) => {
      c.scene.resolution = { width: 1920, height: 1080 };
      c.scene.bubble.diameter = 900;
      c.scene.bubble.margin = 40;
      c.scene.bubble.position = { x: 60 + 450, y: "center" };
    },
  },
  {
    label: "Portrait, bulle en bas",
    apply: (c) => {
      c.scene.resolution = { width: 1080, height: 1920 };
      c.scene.bubble.diameter = 960;
      c.scene.bubble.margin = 40;
      c.scene.bubble.position = { x: "center", y: 1920 - 80 - 480 };
    },
  },
];
