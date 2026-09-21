import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DEFAULT_BONES, DEFAULT_GESTURES } from "@avatar/shared";
import { retargetClip, ClipGestureSource } from "../src/clips.js";
import { resolveBones, type LoadedModel } from "../src/model.js";

function makeModel(): LoadedModel {
  const root = new THREE.Group();
  const hips = new THREE.Bone();
  hips.name = "CC_Base_Hip";
  const spine = new THREE.Bone();
  spine.name = "CC_Base_Waist";
  const head = new THREE.Bone();
  head.name = "CC_Base_Head";
  const leg = new THREE.Bone();
  leg.name = "CC_Base_L_Thigh";
  root.add(hips);
  hips.add(spine, leg);
  spine.add(head);
  const bones = resolveBones(root, DEFAULT_BONES);
  return { root, morphs: [], bones, animations: [], box: new THREE.Box3(), report: {} as LoadedModel["report"] };
}

describe("retargeting par table de noms d'os", () => {
  it("renomme les pistes de rotation vers les os du modèle et ignore le bas du corps", () => {
    const model = makeModel();
    const q = [0, 0, 0, 1, 0, 0.7071, 0, 0.7071];
    const clip = new THREE.AnimationClip("salut", 1, [
      new THREE.QuaternionKeyframeTrack("mixamorigHead.quaternion", [0, 1], q),
      new THREE.QuaternionKeyframeTrack("mixamorigHips.quaternion", [0, 1], q),
      new THREE.QuaternionKeyframeTrack("mixamorigHead.position", [0, 1], [0, 0, 0, 0, 1, 0]),
      new THREE.QuaternionKeyframeTrack("mixamorigLeftArm.quaternion", [0, 1], q),
    ]);
    const r = retargetClip(clip, model, DEFAULT_BONES);
    expect(r.clip.tracks.map((t) => t.name)).toEqual(["CC_Base_Head.quaternion"]);
    expect(r.dropped).toHaveLength(3);
  });

  it("pilote le mixer uniquement par le temps t (résultat identique quel que soit l'ordre)", () => {
    const model = makeModel();
    const q = [0, 0, 0, 1, 0, 0.7071, 0, 0.7071, 0, 0, 0, 1];
    const clip = new THREE.AnimationClip("acquiescement", 1, [new THREE.QuaternionKeyframeTrack("Head.quaternion", [0, 0.5, 1], q)]);
    model.animations = [clip];
    const cfg = { ...DEFAULT_GESTURES, clips: { acquiescement: { clip: "acquiescement" } } };
    const src = new ClipGestureSource(model, [{ at: 2, clip: "acquiescement", source: "test" }], cfg, DEFAULT_BONES, new Map());
    expect(src.resolved).toEqual(["acquiescement"]);
    const head = model.bones.get("head")!.bone;
    const sample = (t: number) => {
      head.quaternion.set(0, 0, 0, 1);
      src.update(t);
      return head.quaternion.toArray().map((v) => Math.round(v * 1000) / 1000);
    };
    const mid = sample(2.5);
    sample(0);
    sample(3.5);
    expect(sample(2.5)).toEqual(mid);
    expect(Math.abs(mid[1])).toBeGreaterThan(0.5);
    expect(sample(1)).toEqual([0, 0, 0, 1]);
  });
});
