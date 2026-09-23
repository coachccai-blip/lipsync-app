/** Formes de bouche produites par Rhubarb (avec les formes étendues G, H, X). */
export type RhubarbShape = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "X";

export type TrackSource = "llm" | "balise" | "procedural" | "manuel" | "test";

export interface Word {
  w: string;
  start: number;
  end: number;
}

export interface VisemeCue {
  start: number;
  end: number;
  shape: RhubarbShape;
}

export interface EnergyTrack {
  /** Échantillons par seconde (normalement = fps). */
  rate: number;
  /** Valeurs normalisées 0..1. */
  values: number[];
}

export interface ExpressionSegment {
  start: number;
  end: number;
  emotion: string;
  intensity: number;
  source: TrackSource;
}

export interface GestureEvent {
  at: number;
  clip: string;
  source: TrackSource;
}

/** Contenu de performance.json : tout ce que la scène a besoin de savoir pour rendre l'image t. */
export interface Performance {
  version: 1;
  fps: number;
  duration: number;
  audio: string;
  text: string;
  words: Word[];
  visemes: VisemeCue[];
  energy: EnergyTrack;
  accents: number[];
  expressions: ExpressionSegment[];
  gestures: GestureEvent[];
  seed: number;
  /** Silence ajouté avant / après la parole (secondes), à titre informatif. */
  padding?: { before: number; after: number };
}

/** Poids de blendshapes ARKit, clé = nom canonique (jawOpen, mouthSmileLeft...). */
export type MorphWeights = Record<string, number>;

/** Rotation d'os en degrés (Euler XYZ), clé = nom canonique de l'os (head, spine, leftArm...). */
export type BoneRotations = Record<string, [number, number, number]>;

// ---------- Configuration (fichiers de config/) ----------

export interface VisemeConfig {
  /** Durée de transition entre deux formes, en ms. */
  transitionMs: number;
  /** Anticipation (la bouche précède le son), en ms. */
  anticipationMs: number;
  /** Facteur global d'exagération (style cartoon). */
  exaggeration: number;
  /** Influence de l'énergie audio locale sur jawOpen (0 = aucune, 1 = forte). */
  energyInfluence: number;
  /** Poids de blendshapes pour chaque forme Rhubarb. */
  shapes: Record<RhubarbShape, MorphWeights>;
}

export interface EmotionConfig {
  /** Durée de fondu entre deux émotions, en ms. */
  fadeMs: number;
  /** Facteur appliqué aux blendshapes de la zone bouche pendant la parole. */
  speechAttenuation: number;
  /** Blendshapes considérés comme « zone bouche ». */
  mouthZone: string[];
  /** Pose de blendshapes de chaque émotion. */
  emotions: Record<string, MorphWeights>;
}

export interface LifeConfig {
  enabled: boolean;
  blink: {
    minInterval: number;
    maxInterval: number;
    duration: number;
    doubleProbability: number;
  };
  gaze: {
    minInterval: number;
    maxInterval: number;
    amplitude: number;
    /** Durée de la saccade (s). */
    duration: number;
  };
  breathing: {
    period: number;
    /** Amplitude de rotation de la colonne en degrés. */
    amplitude: number;
  };
  head: {
    /** Amplitude en degrés des micro-mouvements. */
    amplitude: number;
    /** Vitesse (Hz approximatif). */
    speed: number;
    /** Hochement sur les accents, degrés. */
    nodOnAccent: number;
  };
  brows: {
    /** Haussement sur les accents (0..1). */
    raiseOnAccent: number;
    duration: number;
  };
}

export interface ProceduralKeyframe {
  /** Temps relatif au début du geste (s). */
  t: number;
  bones: BoneRotations;
}

export interface ProceduralGesture {
  duration: number;
  keyframes: ProceduralKeyframe[];
}

export interface GestureConfig {
  /** 'auto' : clips du modèle / assets/clips si disponibles, sinon procédural. */
  source: "auto" | "clips" | "procedural";
  fadeMs: number;
  /** Amplitude globale des gestes procéduraux (1 = tel que défini). */
  intensity: number;
  /**
   * Pose de repos additive (degrés) appliquée en permanence : sert à ramener les bras le long
   * du corps quand le modèle est livré en A-pose ou T-pose. Mettre {} si les clips gèrent la pose.
   */
  restPose: BoneRotations;
  idle: {
    /** Balancement du buste en degrés. */
    swayAmplitude: number;
    swayPeriod: number;
    /** Nom du clip de repos (source clips). */
    clip?: string;
  };
  /** Correspondance nom de geste -> clip d'animation (nom dans le GLB ou fichier dans assets/clips). */
  clips: Record<string, { clip?: string; file?: string }>;
  procedural: Record<string, ProceduralGesture>;
}

export interface SceneConfig {
  model: string;
  resolution: { width: number; height: number };
  fps: number;
  /** Repos avant / après la parole, en secondes. */
  padding: { before: number; after: number };
  background: {
    /** Couleur du fond de page en mode fond vert. */
    color: string;
    /** Seuil d'avertissement : proportion de pixels de texture proches du vert (0..1). */
    greenWarnRatio: number;
  };
  bubble: {
    /** Diamètre en pixels (ou 'auto' = min(width, height) - 2*margin). */
    diameter: number | "auto";
    margin: number;
    /** Position du centre de la bulle : 'center' ou pixels depuis le bord gauche / haut. */
    position: { x: number | "center"; y: number | "center" };
    background: string;
    ring: { enabled: boolean; width: number; color: string };
  };
  camera: {
    fov: number;
    /** Cadrage automatique à partir de la boîte englobante du modèle. */
    autoFrame: boolean;
    /** Fraction de la hauteur du modèle où commence le cadre (0 = pieds, 1 = tête). */
    bottomRatio: number;
    /** Marge au-dessus de la tête, en fraction de la hauteur du modèle. */
    marginTop: number;
    /** Multiplicateur de distance (1 = cadre juste). */
    distanceScale: number;
    /** Décalage vertical de la caméra (fraction de la hauteur du modèle). */
    heightOffset: number;
    /** Position manuelle si autoFrame = false. */
    position: [number, number, number];
    target: [number, number, number];
  };
  lighting: {
    exposure: number;
    ambient: { color: string; intensity: number };
    key: { color: string; intensity: number; position: [number, number, number]; shadows: boolean };
    fill: { color: string; intensity: number; position: [number, number, number] };
    rim: { color: string; intensity: number; position: [number, number, number] };
    eyeCatch: { color: string; intensity: number; position: [number, number, number] };
    environment: { enabled: boolean; intensity: number };
  };
  life: LifeConfig;
  /** Réglages du mode marionnette 2D (modèle = manifeste marionnette.json). */
  marionnette: MarionnetteConfig;
}

export interface MarionnetteConfig {
  /** Zoom de l'image dans la bulle (1 = l'image couvre la bulle). */
  zoom: number;
  /** Décalage du centre, en fraction de la bulle (-0.5..0.5). */
  offsetX: number;
  offsetY: number;
  /** Amplitude des micro-mouvements de tête (pixels par degré). */
  motion: number;
  /** Amplitude de la respiration (fraction d'échelle). */
  breathing: number;
  /** Adoucissement des bords des zones découpées, en pixels de l'image source. */
  feather: number;
  /** Étirement vertical de la bouche selon l'énergie (0 = aucun). */
  mouthEnergy: number;
  /** Intensité minimale d'un segment d'émotion pour afficher son image (les images ne se dosent pas). */
  emotionThreshold: number;
  /** Netteté des transitions de bouche (1 = fondu linéaire, 3 = quasi-bascule). */
  mouthSharpness: number;
}

export interface BoneConfig {
  /** Nom canonique -> liste de noms possibles dans le modèle (insensible à la casse et aux séparateurs). */
  aliases: Record<string, string[]>;
  /** Os dont les pistes d'animation sont conservées (haut du corps). */
  upperBody: string[];
}

export interface AllConfig {
  scene: SceneConfig;
  visemes: VisemeConfig;
  emotions: EmotionConfig;
  gestures: GestureConfig;
  bones: BoneConfig;
}
