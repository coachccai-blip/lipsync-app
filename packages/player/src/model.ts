import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { ARKIT_BLENDSHAPES, normalizeName, resolveMorphTargets, type ArkitName, type BoneConfig, type FrameState } from "@avatar/shared";
import { buildPlaceholder } from "./placeholder.js";

export interface MorphBinding {
  mesh: THREE.Mesh;
  indices: Map<ArkitName, number>;
}

export interface BoneBinding {
  bone: THREE.Object3D;
  rest: THREE.Quaternion;
}

export interface LoadedModel {
  root: THREE.Object3D;
  morphs: MorphBinding[];
  bones: Map<string, BoneBinding>;
  animations: THREE.AnimationClip[];
  box: THREE.Box3;
  report: {
    placeholder: boolean;
    meshesWithMorphs: number;
    blendshapesFound: string[];
    blendshapesMissing: string[];
    unknownMorphs: string[];
    bonesFound: Record<string, string>;
    bonesMissing: string[];
    animations: string[];
    warnings: string[];
    modelHeight: number;
  };
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

export async function loadGltf(url: string): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, (e) => reject(new Error(`Chargement de ${url} impossible : ${(e as Error).message ?? e}`)));
  });
}

/** Charge le GLB (ou le personnage de substitution) et résout blendshapes et os. */
export async function loadModel(url: string | undefined, boneCfg: BoneConfig, greenColor: string, greenWarnRatio: number): Promise<LoadedModel> {
  let root: THREE.Object3D;
  let animations: THREE.AnimationClip[] = [];
  let placeholder = false;
  const warnings: string[] = [];
  if (url) {
    const gltf = await loadGltf(url);
    root = gltf.scene;
    animations = gltf.animations;
  } else {
    root = buildPlaceholder();
    placeholder = true;
  }

  const morphs: MorphBinding[] = [];
  const found = new Set<ArkitName>();
  const unknown = new Set<string>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    if (mesh.morphTargetDictionary) {
      const names = Object.keys(mesh.morphTargetDictionary);
      const r = resolveMorphTargets(names);
      if (r.indices.size) {
        morphs.push({ mesh, indices: r.indices });
        for (const k of r.indices.keys()) found.add(k);
      }
      for (const u of r.unknown) unknown.add(u);
    }
  });
  const missing = ARKIT_BLENDSHAPES.filter((n) => !found.has(n));

  const bones = resolveBones(root, boneCfg);
  const bonesFound: Record<string, string> = {};
  for (const [k, v] of bones) bonesFound[k] = v.bone.name;
  const bonesMissing = Object.keys(boneCfg.aliases).filter((k) => !bones.has(k));

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (!placeholder) {
    if (!found.has("jawOpen")) warnings.push("jawOpen absent : la bouche ne pourra pas s'ouvrir (vérifiez les noms des blendshapes avec inspect-model).");
    if (!bones.has("head")) warnings.push("os « head » introuvable : pas de mouvements de tête (complétez config/bones.json).");
    const green = await greenRatio(root, greenColor);
    if (green > greenWarnRatio) warnings.push(`${Math.round(green * 100)} % des pixels des textures sont proches du vert du fond (#00FF00) : risque de transparence au chroma key.`);
  }

  return {
    root,
    morphs,
    bones,
    animations,
    box,
    report: {
      placeholder,
      meshesWithMorphs: morphs.length,
      blendshapesFound: [...found],
      blendshapesMissing: missing,
      unknownMorphs: [...unknown],
      bonesFound,
      bonesMissing,
      animations: animations.map((a) => `${a.name} (${a.duration.toFixed(2)} s, ${a.tracks.length} pistes)`),
      warnings,
      modelHeight: size.y,
    },
  };
}

/** Résolution tolérante des os via config/bones.json (casse, séparateurs, préfixes). */
export function resolveBones(root: THREE.Object3D, cfg: BoneConfig): Map<string, BoneBinding> {
  const byNorm = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone || o.type === "Bone" || o instanceof THREE.Bone) byNorm.set(normalizeName(o.name), o);
  });
  if (byNorm.size === 0) root.traverse((o) => byNorm.set(normalizeName(o.name), o));
  const out = new Map<string, BoneBinding>();
  for (const [canonical, aliases] of Object.entries(cfg.aliases)) {
    let bone: THREE.Object3D | undefined;
    for (const alias of [canonical, ...aliases]) {
      const n = normalizeName(alias);
      bone = byNorm.get(n);
      if (bone) break;
      for (const [k, v] of byNorm) {
        if (k.endsWith(n) && k.length - n.length <= 12 && !k.includes("end")) {
          bone = v;
          break;
        }
      }
      if (bone) break;
    }
    if (bone) out.set(canonical, { bone, rest: bone.quaternion.clone() });
  }
  return out;
}

async function greenRatio(root: THREE.Object3D, greenColor: string): Promise<number> {
  const target = new THREE.Color(greenColor);
  const seen = new Set<THREE.Texture>();
  let total = 0;
  let green = 0;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const map = (m as THREE.MeshStandardMaterial).map;
      if (!map || seen.has(map) || !map.image) continue;
      seen.add(map);
      try {
        ctx.drawImage(map.image as CanvasImageSource, 0, 0, 64, 64);
        const data = ctx.getImageData(0, 0, 64, 64).data;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          total++;
          const r = data[i] / 255;
          const g = data[i + 1] / 255;
          const b = data[i + 2] / 255;
          if (Math.abs(r - target.r) < 0.25 && Math.abs(g - target.g) < 0.25 && Math.abs(b - target.b) < 0.25 && g > r * 1.4 && g > b * 1.4) green++;
        }
      } catch {
        /* texture non lisible (cross-origin) */
      }
    }
  });
  return total ? green / total : 0;
}

const euler = new THREE.Euler();
const q = new THREE.Quaternion();

const restQ = new THREE.Quaternion();

function eulerDegToQuat(rot: [number, number, number], out: THREE.Quaternion): THREE.Quaternion {
  euler.set(THREE.MathUtils.degToRad(rot[0]), THREE.MathUtils.degToRad(rot[1]), THREE.MathUtils.degToRad(rot[2]), "XYZ");
  return out.setFromEuler(euler);
}

/**
 * Applique un état d'image au modèle. Rotations composées dans l'ordre :
 * pose du fichier (ou clip) × pose de repos (config) × rotations additives (vie, gestes),
 * chacune exprimée dans le repère local de l'os tel qu'il est après l'étape précédente.
 */
export function applyFrame(model: LoadedModel, frame: FrameState, beforeAdditive?: () => void): void {
  for (const b of model.bones.values()) b.bone.quaternion.copy(b.rest);
  beforeAdditive?.();
  for (const [name, rot] of Object.entries(frame.restPose ?? {})) {
    const b = model.bones.get(name);
    if (b) b.bone.quaternion.multiply(eulerDegToQuat(rot, restQ));
  }
  for (const [name, rot] of Object.entries(frame.bones)) {
    const b = model.bones.get(name);
    if (b) b.bone.quaternion.multiply(eulerDegToQuat(rot, q));
  }
  for (const { mesh, indices } of model.morphs) {
    const inf = mesh.morphTargetInfluences;
    if (!inf) continue;
    for (const [name, idx] of indices) inf[idx] = frame.morphs[name] ?? 0;
  }
}
