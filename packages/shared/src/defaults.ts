import type { AllConfig, EmotionConfig, GestureConfig, SceneConfig, VisemeConfig, BoneConfig } from "./types.js";
import { MOUTH_ZONE } from "./arkit.js";

/**
 * Valeurs par défaut. Les fichiers de config/ sont la référence éditable ;
 * ces valeurs servent de repli (page de démonstration, tests) et de base de fusion.
 */
export const DEFAULT_VISEMES: VisemeConfig = {
  transitionMs: 75,
  anticipationMs: 40,
  exaggeration: 1.2,
  energyInfluence: 0.5,
  shapes: {
    X: {},
    A: { mouthClose: 0.3, mouthPressLeft: 0.3, mouthPressRight: 0.3 },
    B: { jawOpen: 0.1, mouthStretchLeft: 0.3, mouthStretchRight: 0.3 },
    C: { jawOpen: 0.35, mouthSmileLeft: 0.15, mouthSmileRight: 0.15 },
    D: { jawOpen: 0.65 },
    E: { jawOpen: 0.3, mouthFunnel: 0.45 },
    F: { jawOpen: 0.15, mouthPucker: 0.8 },
    G: { jawOpen: 0.05, mouthRollLower: 0.5, mouthUpperUpLeft: 0.2, mouthUpperUpRight: 0.2 },
    H: { jawOpen: 0.3, tongueOut: 0.1 },
  },
};

export const DEFAULT_EMOTIONS: EmotionConfig = {
  fadeMs: 400,
  speechAttenuation: 0.4,
  mouthZone: MOUTH_ZONE,
  emotions: {
    neutre: {},
    enjoué: { mouthSmileLeft: 0.55, mouthSmileRight: 0.55, cheekSquintLeft: 0.3, cheekSquintRight: 0.3, browInnerUp: 0.15, eyeSquintLeft: 0.15, eyeSquintRight: 0.15 },
    sérieux: { browDownLeft: 0.35, browDownRight: 0.35, mouthPressLeft: 0.2, mouthPressRight: 0.2, eyeSquintLeft: 0.1, eyeSquintRight: 0.1 },
    surpris: { browInnerUp: 0.7, browOuterUpLeft: 0.6, browOuterUpRight: 0.6, eyeWideLeft: 0.6, eyeWideRight: 0.6, jawOpen: 0.15 },
    inquiet: { browInnerUp: 0.6, browDownLeft: 0.15, browDownRight: 0.15, mouthFrownLeft: 0.3, mouthFrownRight: 0.3, eyeWideLeft: 0.2, eyeWideRight: 0.2 },
    complice: { mouthSmileLeft: 0.5, mouthSmileRight: 0.25, eyeSquintLeft: 0.35, eyeSquintRight: 0.15, browOuterUpLeft: 0.3, cheekSquintLeft: 0.3 },
    enthousiaste: { mouthSmileLeft: 0.75, mouthSmileRight: 0.75, browInnerUp: 0.4, browOuterUpLeft: 0.4, browOuterUpRight: 0.4, eyeWideLeft: 0.3, eyeWideRight: 0.3, cheekSquintLeft: 0.35, cheekSquintRight: 0.35 },
    pensif: { browDownLeft: 0.2, browInnerUp: 0.25, eyeLookUpLeft: 0.3, eyeLookUpRight: 0.3, mouthPressLeft: 0.25, mouthPressRight: 0.25, mouthLeft: 0.2 },
  },
};

export const DEFAULT_GESTURES: GestureConfig = {
  source: "auto",
  fadeMs: 300,
  intensity: 1,
  // Convention d'axes (squelettes Mixamo et assimilés) : X = balancer vers l'avant, Y = pivoter
  // sur soi-même, Z = écarter / rabattre dans le plan frontal (Z > 0 rabat le bras droit contre le
  // corps, Z < 0 rabat le bras gauche). Les valeurs sont additives sur la pose du fichier.
  restPose: {
    rightArm: [0, 0, 48],
    leftArm: [0, 0, -48],
    rightForeArm: [10, 0, 0],
    leftForeArm: [10, 0, 0],
  },
  idle: { swayAmplitude: 1.2, swayPeriod: 5.5 },
  clips: {
    salut: { clip: "salut" },
    explication: { clip: "explication" },
    index: { clip: "index" },
    haussement_epaules: { clip: "haussement_epaules" },
    mains_ouvertes: { clip: "mains_ouvertes" },
    acquiescement: { clip: "acquiescement" },
    negation: { clip: "negation" },
    reflexion: { clip: "reflexion" },
  },
  procedural: {
    // Axes observés sur le modèle de démonstration (squelette MPFB / Mixamo), depuis la pose de
    // repos : bras Z<0 = lever sur le côté, bras Y>0 (droite) / Y<0 (gauche) = avancer,
    // bras X<0 = écarter ; avant-bras Z<0 = plier vers l'avant, X<0 = plier vers le haut quand le
    // bras est levé. Vérifiez avec `avatar planche <projet>` et ajustez ici pour un autre modèle.
    salut: {
      duration: 1.8,
      keyframes: [
        { t: 0, bones: {} },
        { t: 0.4, bones: { rightArm: [0, 0, -105], rightForeArm: [-95, 0, 0], rightHand: [0, 0, -10] } },
        { t: 0.7, bones: { rightArm: [0, 0, -105], rightForeArm: [-70, 0, 0], rightHand: [0, 0, 15] } },
        { t: 1.0, bones: { rightArm: [0, 0, -105], rightForeArm: [-95, 0, 0], rightHand: [0, 0, -10] } },
        { t: 1.3, bones: { rightArm: [0, 0, -105], rightForeArm: [-75, 0, 0], rightHand: [0, 0, 10] } },
        { t: 1.8, bones: {} },
      ],
    },
    explication: {
      duration: 2.0,
      keyframes: [
        { t: 0, bones: {} },
        { t: 0.45, bones: { rightArm: [-5, 20, 0], rightForeArm: [0, 0, -110], leftArm: [5, -20, 0], leftForeArm: [0, 0, -110] } },
        { t: 1.0, bones: { rightArm: [-18, 25, 0], rightForeArm: [0, 0, -95], leftArm: [18, -25, 0], leftForeArm: [0, 0, -95] } },
        { t: 1.5, bones: { rightArm: [-5, 20, 0], rightForeArm: [0, 0, -110], leftArm: [5, -20, 0], leftForeArm: [0, 0, -110] } },
        { t: 2.0, bones: {} },
      ],
    },
    index: {
      duration: 1.6,
      keyframes: [
        { t: 0, bones: {} },
        { t: 0.4, bones: { rightArm: [-8, 45, 0], rightForeArm: [0, 0, -55], rightHand: [0, 0, 10] } },
        { t: 0.6, bones: { rightArm: [-10, 50, 0], rightForeArm: [0, 0, -45], rightHand: [0, 0, 10] } },
        { t: 1.0, bones: { rightArm: [-8, 45, 0], rightForeArm: [0, 0, -55], rightHand: [0, 0, 10] } },
        { t: 1.6, bones: {} },
      ],
    },
    haussement_epaules: {
      duration: 1.5,
      keyframes: [
        { t: 0, bones: {} },
        { t: 0.4, bones: { rightShoulder: [0, 0, -12], leftShoulder: [0, 0, 12], rightArm: [-12, 10, 0], leftArm: [12, -10, 0], rightForeArm: [0, 0, -95], leftForeArm: [0, 0, -95], rightHand: [0, 40, 0], leftHand: [0, -40, 0], head: [3, 0, 7] } },
        { t: 1.0, bones: { rightShoulder: [0, 0, -12], leftShoulder: [0, 0, 12], rightArm: [-12, 10, 0], leftArm: [12, -10, 0], rightForeArm: [0, 0, -95], leftForeArm: [0, 0, -95], rightHand: [0, 40, 0], leftHand: [0, -40, 0], head: [3, 0, 7] } },
        { t: 1.5, bones: {} },
      ],
    },
    mains_ouvertes: {
      duration: 1.8,
      keyframes: [
        { t: 0, bones: {} },
        { t: 0.5, bones: { rightArm: [-20, 30, 0], leftArm: [20, -30, 0], rightForeArm: [0, 0, -95], leftForeArm: [0, 0, -95], rightHand: [0, 35, 0], leftHand: [0, -35, 0] } },
        { t: 1.2, bones: { rightArm: [-20, 30, 0], leftArm: [20, -30, 0], rightForeArm: [0, 0, -95], leftForeArm: [0, 0, -95], rightHand: [0, 35, 0], leftHand: [0, -35, 0] } },
        { t: 1.8, bones: {} },
      ],
    },
    acquiescement: {
      duration: 1.0,
      keyframes: [
        { t: 0, bones: {} },
        { t: 0.2, bones: { head: [9, 0, 0] } },
        { t: 0.45, bones: { head: [-2, 0, 0] } },
        { t: 0.65, bones: { head: [7, 0, 0] } },
        { t: 1.0, bones: {} },
      ],
    },
    negation: {
      duration: 1.1,
      keyframes: [
        { t: 0, bones: {} },
        { t: 0.2, bones: { head: [0, 12, 0] } },
        { t: 0.5, bones: { head: [0, -12, 0] } },
        { t: 0.8, bones: { head: [0, 8, 0] } },
        { t: 1.1, bones: {} },
      ],
    },
    reflexion: {
      duration: 2.4,
      keyframes: [
        { t: 0, bones: {} },
        { t: 0.7, bones: { rightArm: [-5, 25, 0], rightForeArm: [0, 0, -140], rightHand: [-20, 0, 0], head: [-3, 10, 6] } },
        { t: 1.8, bones: { rightArm: [-5, 25, 0], rightForeArm: [0, 0, -140], rightHand: [-20, 0, 0], head: [-3, 12, 7] } },
        { t: 2.4, bones: {} },
      ],
    },
  },
};

export const DEFAULT_BONES: BoneConfig = {
  aliases: {
    hips: ["Hips", "mixamorigHips", "pelvis", "CC_Base_Hip", "J_Bip_C_Hips"],
    spine: ["Spine", "mixamorigSpine", "spine_01", "CC_Base_Waist", "J_Bip_C_Spine"],
    spine1: ["Spine1", "mixamorigSpine1", "spine_02", "CC_Base_Spine01", "J_Bip_C_Chest"],
    spine2: ["Spine2", "mixamorigSpine2", "spine_03", "CC_Base_Spine02", "J_Bip_C_UpperChest"],
    neck: ["Neck", "mixamorigNeck", "neck_01", "CC_Base_NeckTwist01", "J_Bip_C_Neck"],
    head: ["Head", "mixamorigHead", "head", "CC_Base_Head", "J_Bip_C_Head"],
    leftShoulder: ["LeftShoulder", "mixamorigLeftShoulder", "clavicle_l", "CC_Base_L_Clavicle", "J_Bip_L_Shoulder"],
    rightShoulder: ["RightShoulder", "mixamorigRightShoulder", "clavicle_r", "CC_Base_R_Clavicle", "J_Bip_R_Shoulder"],
    leftArm: ["LeftArm", "mixamorigLeftArm", "upperarm_l", "CC_Base_L_Upperarm", "J_Bip_L_UpperArm"],
    rightArm: ["RightArm", "mixamorigRightArm", "upperarm_r", "CC_Base_R_Upperarm", "J_Bip_R_UpperArm"],
    leftForeArm: ["LeftForeArm", "mixamorigLeftForeArm", "lowerarm_l", "CC_Base_L_Forearm", "J_Bip_L_LowerArm"],
    rightForeArm: ["RightForeArm", "mixamorigRightForeArm", "lowerarm_r", "CC_Base_R_Forearm", "J_Bip_R_LowerArm"],
    leftHand: ["LeftHand", "mixamorigLeftHand", "hand_l", "CC_Base_L_Hand", "J_Bip_L_Hand"],
    rightHand: ["RightHand", "mixamorigRightHand", "hand_r", "CC_Base_R_Hand", "J_Bip_R_Hand"],
    leftEye: ["LeftEye", "mixamorigLeftEye", "eye_l", "CC_Base_L_Eye", "J_Adj_L_FaceEye"],
    rightEye: ["RightEye", "mixamorigRightEye", "eye_r", "CC_Base_R_Eye", "J_Adj_R_FaceEye"],
  },
  upperBody: ["spine", "spine1", "spine2", "neck", "head", "leftShoulder", "rightShoulder", "leftArm", "rightArm", "leftForeArm", "rightForeArm", "leftHand", "rightHand", "leftEye", "rightEye"],
};

export const DEFAULT_SCENE: SceneConfig = {
  model: "assets/marionnette/marionnette.json",
  resolution: { width: 1080, height: 1080 },
  fps: 30,
  padding: { before: 0.5, after: 0.5 },
  background: { color: "#00FF00", greenWarnRatio: 0.05 },
  bubble: {
    shape: "cercle",
    cornerRadius: 96,
    parallaxe: 3,
    diameter: "auto",
    margin: 40,
    position: { x: "center", y: "center" },
    background: "radial-gradient(circle at 50% 35%, #fff7e6 0%, #f3d9b1 60%, #e6c28f 100%)",
    couleur: "#f3d9b1",
    fondLibre: false,
    ring: { enabled: true, width: 14, color: "#ffffff" },
  },
  camera: {
    fov: 28,
    autoFrame: true,
    bottomRatio: 0.55,
    marginTop: 0.12,
    distanceScale: 1.0,
    heightOffset: 0,
    position: [0, 1.5, 2.2],
    target: [0, 1.4, 0],
  },
  lighting: {
    exposure: 1.0,
    ambient: { color: "#ffffff", intensity: 0.35 },
    // positions relatives au centre du cadre (x droite, y haut, z vers la caméra)
    key: { color: "#fff1e0", intensity: 2.4, position: [1.2, 0.9, 1.6], shadows: true },
    fill: { color: "#dbe9ff", intensity: 0.9, position: [-1.8, 0.2, 1.2] },
    rim: { color: "#ffffff", intensity: 1.4, position: [-0.6, 0.9, -1.8] },
    eyeCatch: { color: "#ffffff", intensity: 0.6, position: [0.3, 0.3, 1.4] },
    environment: { enabled: true, intensity: 0.5 },
  },
  post: { vignette: 0.18, grain: 0.035, nettete: 0.3 },
  marionnette: { zoom: 1.0, offsetX: 0, offsetY: 0, motion: 1.6, breathing: 0.006, feather: 18, mouthEnergy: 0.08, emotionThreshold: 0.3, mouthSharpness: 4, seuilBruit: 20, lissage: 0.6, suivi: 0.6, ombre: 0.22, regard: true, sourcilsAccent: 0.55, mains: true, epaules: 0.8 },
  life: {
    enabled: true,
    blink: { minInterval: 2, maxInterval: 6, duration: 0.16, doubleProbability: 0.15 },
    gaze: { minInterval: 0.8, maxInterval: 3.5, amplitude: 0.25, duration: 0.12 },
    breathing: { period: 4.2, amplitude: 0.8 },
    head: { amplitude: 2.2, speed: 0.18, nodOnAccent: 2, tiltOnQuestion: 2.5 },
    brows: { raiseOnAccent: 0.25, duration: 0.35 },
  },
};

export const DEFAULT_CONFIG: AllConfig = {
  scene: DEFAULT_SCENE,
  visemes: DEFAULT_VISEMES,
  emotions: DEFAULT_EMOTIONS,
  gestures: DEFAULT_GESTURES,
  bones: DEFAULT_BONES,
};

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

/**
 * Fusion profonde (les objets sont fusionnés, les tableaux et scalaires remplacés).
 * Le résultat est toujours une copie : les valeurs par défaut ne sont jamais partagées ni mutées.
 */
export function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined || override === null) return clone(base);
  if (Array.isArray(base) || Array.isArray(override) || typeof base !== "object" || typeof override !== "object" || base === null) {
    return clone(override) as T;
  }
  const out: Record<string, unknown> = { ...clone(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    out[k] = deepMerge((base as Record<string, unknown>)[k], v);
  }
  return out as T;
}

export function mergeConfig(partial: Partial<Record<keyof AllConfig, unknown>>): AllConfig {
  return {
    scene: deepMerge(DEFAULT_SCENE, partial.scene),
    visemes: deepMerge(DEFAULT_VISEMES, partial.visemes),
    emotions: deepMerge(DEFAULT_EMOTIONS, partial.emotions),
    gestures: deepMerge(DEFAULT_GESTURES, partial.gestures),
    bones: deepMerge(DEFAULT_BONES, partial.bones),
  };
}
