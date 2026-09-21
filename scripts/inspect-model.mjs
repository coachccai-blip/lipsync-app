#!/usr/bin/env node
/**
 * scripts/inspect-model <fichier.glb> : liste les os (squelettes), les blendshapes par
 * maillage (avec correspondance ARKit) et les animations embarquées. Lecture directe du
 * GLB, sans dépendance à Three.js.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let file = process.argv[2];
if (!file) {
  const dir = path.join(root, "assets", "models");
  const found = existsSync(dir) ? readdirSync(dir).filter((f) => /\.glb$/i.test(f)) : [];
  if (found.length === 0) {
    console.error("Usage : npm run inspect-model -- assets/models/personnage.glb");
    process.exit(1);
  }
  file = path.join(dir, found[0]);
}

const ARKIT = ["eyeBlinkLeft","eyeLookDownLeft","eyeLookInLeft","eyeLookOutLeft","eyeLookUpLeft","eyeSquintLeft","eyeWideLeft","eyeBlinkRight","eyeLookDownRight","eyeLookInRight","eyeLookOutRight","eyeLookUpRight","eyeSquintRight","eyeWideRight","jawForward","jawLeft","jawRight","jawOpen","mouthClose","mouthFunnel","mouthPucker","mouthLeft","mouthRight","mouthSmileLeft","mouthSmileRight","mouthFrownLeft","mouthFrownRight","mouthDimpleLeft","mouthDimpleRight","mouthStretchLeft","mouthStretchRight","mouthRollLower","mouthRollUpper","mouthShrugLower","mouthShrugUpper","mouthPressLeft","mouthPressRight","mouthLowerDownLeft","mouthLowerDownRight","mouthUpperUpLeft","mouthUpperUpRight","browDownLeft","browDownRight","browInnerUp","browOuterUpLeft","browOuterUpRight","cheekPuff","cheekSquintLeft","cheekSquintRight","noseSneerLeft","noseSneerRight","tongueOut"];
const norm = (n) => (n.split(/[.:/|]/).pop() ?? n).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
const arkitByNorm = new Map(ARKIT.map((n) => [norm(n), n]));
const EXTRA = { mouthsmile_l: "mouthSmileLeft", mouthsmile_r: "mouthSmileRight", eyeblink_l: "eyeBlinkLeft", eyeblink_r: "eyeBlinkRight" };
/** Même résolution tolérante que le player (casse, séparateurs, préfixes, alias connus). */
function toArkit(name) {
  const n = norm(name);
  const direct = arkitByNorm.get(n) ?? EXTRA[name.toLowerCase()];
  if (direct) return direct;
  for (const [k, v] of arkitByNorm) if (n.endsWith(k) && n.length - k.length <= 12) return v;
  return undefined;
}

const buf = readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546c67) {
  console.error(`${file} n'est pas un GLB (en-tête glTF absent)`);
  process.exit(1);
}
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen));
const binStart = 20 + jsonLen + 8;

console.log(`\n${path.relative(root, file)} — ${(buf.length / 1024 / 1024).toFixed(1)} Mo, glTF ${gltf.asset?.version ?? "?"}${gltf.asset?.generator ? ` (${gltf.asset.generator})` : ""}`);
if (gltf.extensionsRequired?.length) console.log(`extensions requises : ${gltf.extensionsRequired.join(", ")}`);

const nodes = gltf.nodes ?? [];
const skins = gltf.skins ?? [];
console.log(`\n== Os (${skins.length} squelette(s)) ==`);
if (skins.length === 0) console.log("aucun squelette (skin) : pas d'os, gestes procéduraux impossibles sur ce modèle");
for (const [i, skin] of skins.entries()) {
  console.log(`squelette ${i}${skin.name ? ` « ${skin.name} »` : ""} : ${skin.joints.length} os`);
  const children = new Map();
  for (const j of skin.joints) for (const c of nodes[j].children ?? []) children.set(c, j);
  const roots = skin.joints.filter((j) => !children.has(j));
  const print = (j, depth) => {
    if (depth > 40) return;
    console.log(`  ${"  ".repeat(depth)}${nodes[j].name ?? `node${j}`}`);
    for (const c of nodes[j].children ?? []) if (skin.joints.includes(c)) print(c, depth + 1);
  };
  for (const r of roots) print(r, 0);
}

console.log("\n== Blendshapes (morph targets) ==");
const meshes = gltf.meshes ?? [];
const allFound = new Set();
let any = false;
for (const [mi, mesh] of meshes.entries()) {
  const names = mesh.extras?.targetNames ?? mesh.primitives?.[0]?.extras?.targetNames;
  const count = mesh.primitives?.[0]?.targets?.length ?? 0;
  if (!count) continue;
  any = true;
  const list = names ?? Array.from({ length: count }, (_, k) => `cible_${k}`);
  const found = [];
  const unknown = [];
  for (const n of list) {
    const c = toArkit(n);
    if (c) {
      found.push(`${n}${c !== n ? ` → ${c}` : ""}`);
      allFound.add(c);
    } else unknown.push(n);
  }
  console.log(`maillage ${mi} « ${mesh.name ?? "?"} » : ${count} cibles, ${found.length} ARKit`);
  if (found.length) console.log(`  ARKit : ${found.join(", ")}`);
  if (unknown.length) console.log(`  autres : ${unknown.join(", ")}`);
  if (!names) console.log("  (noms absents du fichier : extras.targetNames manquant)");
}
if (!any) console.log("aucun morph target : le lip sync par blendshapes est impossible sur ce modèle");
const missing = ARKIT.filter((n) => !allFound.has(n));
console.log(`\nARKit trouvés (tous maillages) : ${allFound.size}/52${missing.length ? `\nARKit manquants : ${missing.join(", ")}` : ""}`);

console.log("\n== Animations ==");
const anims = gltf.animations ?? [];
if (anims.length === 0) console.log("aucune animation embarquée : gestes via assets/clips/ (retargeting) ou procéduraux");
const accessors = gltf.accessors ?? [];
for (const [i, a] of anims.entries()) {
  let duration = 0;
  const targets = new Set();
  for (const ch of a.channels ?? []) {
    const s = a.samplers[ch.sampler];
    const input = accessors[s.input];
    if (input?.max?.[0] > duration) duration = input.max[0];
    if (ch.target?.node !== undefined) targets.add(nodes[ch.target.node]?.name ?? `node${ch.target.node}`);
    if (ch.target?.path === "weights") targets.add("(poids de blendshapes)");
  }
  console.log(`${i}. « ${a.name ?? "sans nom"} » : ${duration.toFixed(2)} s, ${a.channels?.length ?? 0} canaux, os : ${[...targets].slice(0, 12).join(", ")}${targets.size > 12 ? "…" : ""}`);
}

console.log("\n== Matériaux et textures ==");
console.log(`${(gltf.materials ?? []).length} matériau(x), ${(gltf.images ?? []).length} image(s), ${(gltf.textures ?? []).length} texture(s)`);
console.log(`\nAstuce : complétez config/bones.json (aliases) avec les noms d'os ci-dessus si des os sont signalés manquants au chargement.\n`);
void binStart;
