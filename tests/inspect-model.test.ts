import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Construit un GLB minimal (JSON seul) avec squelette, blendshapes et animation. */
function makeGlb(): string {
  const gltf = {
    asset: { version: "2.0", generator: "test" },
    nodes: [
      { name: "mixamorig:Hips", children: [1] },
      { name: "mixamorig:Spine", children: [2] },
      { name: "mixamorig:Head" },
      { name: "Face", mesh: 0, skin: 0 },
    ],
    skins: [{ name: "Armature", joints: [0, 1, 2] }],
    meshes: [{ name: "Face", primitives: [{ attributes: { POSITION: 0 }, targets: [{ POSITION: 0 }, { POSITION: 0 }, { POSITION: 0 }] }], extras: { targetNames: ["Jaw_Open", "mouthSmile_L", "Sourire"] } }],
    accessors: [{ componentType: 5126, count: 1, type: "VEC3", max: [1.5, 0, 0], min: [0, 0, 0] }],
    animations: [{ name: "Wave", channels: [{ sampler: 0, target: { node: 2, path: "rotation" } }], samplers: [{ input: 0, output: 0 }] }],
  };
  const json = Buffer.from(JSON.stringify(gltf));
  const pad = (4 - (json.length % 4)) % 4;
  const jsonChunk = Buffer.concat([json, Buffer.alloc(pad, 0x20)]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length, 8);
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(jsonChunk.length, 0);
  chunkHeader.writeUInt32LE(0x4e4f534a, 4);
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "avatar-glb-")), "test.glb");
  writeFileSync(file, Buffer.concat([header, chunkHeader, jsonChunk]));
  return file;
}

describe("scripts/inspect-model", () => {
  it("liste os, blendshapes (avec correspondance ARKit) et animations", () => {
    const out = execFileSync("node", [path.join(root, "scripts", "inspect-model.mjs"), makeGlb()], { encoding: "utf8" });
    expect(out).toContain("mixamorig:Hips");
    expect(out).toContain("    mixamorig:Head");
    expect(out).toContain("Jaw_Open → jawOpen");
    expect(out).toContain("mouthSmile_L → mouthSmileLeft");
    expect(out).toContain("autres : Sourire");
    expect(out).toContain("ARKit trouvés (tous maillages) : 2/52");
    expect(out).toContain("« Wave » : 1.50 s, 1 canaux, os : mixamorig:Head");
  });
});
