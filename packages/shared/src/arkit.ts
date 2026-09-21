/** Les 52 blendshapes ARKit. */
export const ARKIT_BLENDSHAPES = [
  "eyeBlinkLeft", "eyeLookDownLeft", "eyeLookInLeft", "eyeLookOutLeft", "eyeLookUpLeft", "eyeSquintLeft", "eyeWideLeft",
  "eyeBlinkRight", "eyeLookDownRight", "eyeLookInRight", "eyeLookOutRight", "eyeLookUpRight", "eyeSquintRight", "eyeWideRight",
  "jawForward", "jawLeft", "jawRight", "jawOpen",
  "mouthClose", "mouthFunnel", "mouthPucker", "mouthLeft", "mouthRight",
  "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight",
  "mouthDimpleLeft", "mouthDimpleRight", "mouthStretchLeft", "mouthStretchRight",
  "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
  "mouthPressLeft", "mouthPressRight", "mouthLowerDownLeft", "mouthLowerDownRight",
  "mouthUpperUpLeft", "mouthUpperUpRight",
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
  "noseSneerLeft", "noseSneerRight",
  "tongueOut",
] as const;

export type ArkitName = (typeof ARKIT_BLENDSHAPES)[number];

/** Blendshapes de la zone bouche (la piste bouche y est prioritaire). */
export const MOUTH_ZONE: string[] = ARKIT_BLENDSHAPES.filter(
  (n) => n.startsWith("mouth") || n.startsWith("jaw") || n === "tongueOut",
);

/**
 * Normalise un nom de blendshape ou d'os : dernier segment après '.', ':' ou '/',
 * sans séparateurs, en minuscules. `CC_Base.Jaw_Open` -> `jawopen`.
 */
export function normalizeName(name: string): string {
  const last = name.split(/[.:/|]/).pop() ?? name;
  return last.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

const CANONICAL_BY_NORMALIZED = new Map<string, ArkitName>(
  ARKIT_BLENDSHAPES.map((n) => [normalizeName(n), n] as const),
);

/** Variantes connues (préfixes numérotés de certains exports, noms alternatifs). */
const EXTRA_ALIASES: Record<string, ArkitName> = {
  mouthsmile_l: "mouthSmileLeft",
  mouthsmile_r: "mouthSmileRight",
  eyeblink_l: "eyeBlinkLeft",
  eyeblink_r: "eyeBlinkRight",
  jaw_open: "jawOpen",
  browinnerup: "browInnerUp",
};

export interface MorphResolution {
  /** Nom canonique -> index dans le tableau de morph targets du maillage. */
  indices: Map<ArkitName, number>;
  /** Blendshapes ARKit absents du maillage. */
  missing: ArkitName[];
  /** Noms du maillage qui ne correspondent à aucun blendshape ARKit. */
  unknown: string[];
}

/** Résout les noms de morph targets d'un maillage vers les noms canoniques ARKit. */
export function resolveMorphTargets(targetNames: string[]): MorphResolution {
  const indices = new Map<ArkitName, number>();
  const unknown: string[] = [];
  targetNames.forEach((raw, index) => {
    const norm = normalizeName(raw);
    const lowered = raw.toLowerCase();
    const canonical = CANONICAL_BY_NORMALIZED.get(norm) ?? EXTRA_ALIASES[lowered] ?? matchSuffix(norm);
    if (canonical && !indices.has(canonical)) indices.set(canonical, index);
    else if (!canonical) unknown.push(raw);
  });
  const missing = ARKIT_BLENDSHAPES.filter((n) => !indices.has(n));
  return { indices, missing, unknown };
}

function matchSuffix(norm: string): ArkitName | undefined {
  // ex: "blendshape1jawopen" ou "arkitjawopen"
  for (const [k, v] of CANONICAL_BY_NORMALIZED) {
    if (norm.endsWith(k) && norm.length - k.length <= 12) return v;
  }
  return undefined;
}
