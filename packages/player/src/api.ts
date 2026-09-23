import type { AllConfig, Performance } from "@avatar/shared";

export type PlayerMode = "render" | "studio" | "demo";

export interface ProjectPayload {
  performance: Performance;
  /** Configuration complète (déjà fusionnée avec les valeurs par défaut). */
  config: AllConfig;
  /** URL du modèle GLB (absolue ou relative à la page). Absente : personnage de substitution. */
  modelUrl?: string;
  /** URL de l'audio (prévisualisation uniquement). */
  audioUrl?: string;
  /** URLs des clips externes (assets/clips) par nom de fichier. */
  clipUrls?: Record<string, string>;
  /** 'green' : fond de page coloré ; 'transparent' : fond transparent. */
  background?: "green" | "transparent";
}

export interface LoadReport {
  /** Type de personnage : modèle 3D (GLB ou substitution) ou marionnette 2D. */
  kind?: "3d" | "marionnette";
  model: string;
  placeholder: boolean;
  meshesWithMorphs: number;
  blendshapesFound: string[];
  blendshapesMissing: string[];
  unknownMorphs: string[];
  bonesFound: Record<string, string>;
  bonesMissing: string[];
  animations: string[];
  gestureSource: "clips" | "procedural";
  clipsResolved: string[];
  clipsMissing: string[];
  renderer: string;
  software: boolean;
  warnings: string[];
  modelHeight: number;
  marionnette?: { mouths: string[]; eyes: string[]; emotions: string[]; regions: { mouth: { x: number; y: number; w: number; h: number }; eyes: { x: number; y: number; w: number; h: number } }; size: [number, number] };
}

declare global {
  interface Window {
    loadProject: (data: ProjectPayload) => Promise<LoadReport>;
    renderFrame: (t: number) => Promise<void>;
    getDuration: () => number;
    getReport: () => LoadReport | undefined;
    setOverrideMorphs: (m: Record<string, number> | null) => void;
    avatarReady: Promise<void>;
    __avatarError?: string;
    __studio?: unknown;
  }
}
