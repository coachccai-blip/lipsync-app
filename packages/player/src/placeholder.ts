import * as THREE from "three";

/**
 * Personnage de substitution : buste cartoon procédural avec de vrais morph targets
 * (jawOpen, mouthSmileLeft/Right, mouthPucker, mouthFunnel, eyeBlinkLeft/Right,
 * browInnerUp, browOuterUpLeft/Right...) et des « os » nommés (Head, Neck, Spine,
 * LeftArm, RightArm...). Il permet de vérifier cadrage, bulle, lip sync et vie
 * procédurale sans modèle GLB.
 */
type Displace = (x: number, y: number, z: number) => [number, number, number];

function addMorph(geometry: THREE.BufferGeometry, name: string, displace: Displace): void {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const delta = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const [dx, dy, dz] = displace(pos.getX(i), pos.getY(i), pos.getZ(i));
    delta[i * 3] = dx;
    delta[i * 3 + 1] = dy;
    delta[i * 3 + 2] = dz;
  }
  geometry.morphAttributes.position ??= [];
  const attr = new THREE.Float32BufferAttribute(delta, 3);
  attr.name = name;
  geometry.morphAttributes.position.push(attr);
  geometry.morphTargetsRelative = true;
}

function meshWithMorphs(geometry: THREE.BufferGeometry, material: THREE.Material, morphs: Record<string, Displace>): THREE.Mesh {
  for (const [name, fn] of Object.entries(morphs)) addMorph(geometry, name, fn);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.updateMorphTargets();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export function buildPlaceholder(): THREE.Group {
  const root = new THREE.Group();
  root.name = "Placeholder";
  const skin = new THREE.MeshStandardMaterial({ color: 0xf2c9a0, roughness: 0.65, metalness: 0 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3b2a22, roughness: 0.8 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x3d7bd9, roughness: 0.7 });
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x5a1f1f, roughness: 0.9 });

  // squelette simplifié : Hips > Spine > Spine1 > Spine2 > Neck > Head ; épaules et bras
  const bone = (name: string, y: number, parent: THREE.Object3D) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.y = y;
    parent.add(b);
    return b;
  };
  const hips = bone("Hips", 0.95, root);
  const spine = bone("Spine", 0.1, hips);
  const spine1 = bone("Spine1", 0.12, spine);
  const spine2 = bone("Spine2", 0.12, spine1);
  const neck = bone("Neck", 0.16, spine2);
  const head = bone("Head", 0.08, neck);

  // jambes (verrouillées) : donnent au modèle une hauteur de personnage complet pour le cadrage
  const pants = new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.8 });
  for (const s of [1, -1]) {
    const leg = new THREE.Bone();
    leg.name = s > 0 ? "LeftUpLeg" : "RightUpLeg";
    leg.position.set(s * 0.09, -0.05, 0);
    hips.add(leg);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.7, 6, 16), pants);
    mesh.position.y = -0.45;
    mesh.castShadow = mesh.receiveShadow = true;
    leg.add(mesh);
  }

  // torse
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.28, 8, 24), shirt);
  torso.position.y = 0.1;
  torso.scale.set(1.25, 1, 0.8);
  torso.castShadow = torso.receiveShadow = true;
  spine.add(torso);
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.14, 24), skin);
  neckMesh.position.y = 0.06;
  neckMesh.castShadow = true;
  spine2.add(neckMesh);

  // bras : pivot à l'épaule, tombant le long du corps
  for (const side of ["Left", "Right"] as const) {
    const s = side === "Left" ? 1 : -1;
    const shoulder = new THREE.Bone();
    shoulder.name = `${side}Shoulder`;
    shoulder.position.set(s * 0.12, 0.12, 0);
    spine2.add(shoulder);
    const arm = new THREE.Bone();
    arm.name = `${side}Arm`;
    arm.position.set(s * 0.12, 0, 0);
    shoulder.add(arm);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.22, 6, 16), shirt);
    upper.position.y = -0.13;
    upper.castShadow = true;
    arm.add(upper);
    const fore = new THREE.Bone();
    fore.name = `${side}ForeArm`;
    fore.position.y = -0.27;
    arm.add(fore);
    const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.2, 6, 16), skin);
    lower.position.y = -0.12;
    lower.castShadow = true;
    fore.add(lower);
    const hand = new THREE.Bone();
    hand.name = `${side}Hand`;
    hand.position.y = -0.25;
    fore.add(hand);
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), skin);
    palm.position.y = -0.04;
    palm.castShadow = true;
    hand.add(palm);
  }

  // tête : sphère avec mâchoire déformable
  const headGeo = new THREE.SphereGeometry(0.2, 48, 40);
  const R = 0.2;
  const headMesh = meshWithMorphs(headGeo, skin, {
    jawOpen: (x, y, z) => {
      // la partie basse avant descend et s'étire
      const w = smooth((-y - 0.02) / 0.16) * smooth((z + 0.05) / 0.2);
      return [0, -0.09 * w, 0.01 * w];
    },
    mouthSmileLeft: (x, y, z) => {
      const w = Math.exp(-(((x - 0.09) ** 2 + (y + 0.08) ** 2) / 0.004)) * (z > 0 ? 1 : 0);
      return [0.015 * w, 0.02 * w, 0];
    },
    mouthSmileRight: (x, y, z) => {
      const w = Math.exp(-(((x + 0.09) ** 2 + (y + 0.08) ** 2) / 0.004)) * (z > 0 ? 1 : 0);
      return [-0.015 * w, 0.02 * w, 0];
    },
    mouthPucker: (x, y, z) => {
      const w = Math.exp(-((x ** 2 + (y + 0.08) ** 2) / 0.006)) * smooth(z / R);
      return [-0.4 * x * w, 0, 0.04 * w];
    },
    mouthFunnel: (x, y, z) => {
      const w = Math.exp(-((x ** 2 + (y + 0.08) ** 2) / 0.008)) * smooth(z / R);
      return [-0.2 * x * w, 0, 0.03 * w];
    },
    cheekPuff: (x, y, z) => {
      const w = Math.exp(-((Math.abs(x) - 0.13) ** 2 / 0.003 + (y + 0.03) ** 2 / 0.004)) * (z > 0 ? 1 : 0);
      return [Math.sign(x) * 0.03 * w, 0, 0.01 * w];
    },
  });
  headMesh.position.y = 0.2;
  head.add(headMesh);

  // bouche : ellipse sombre dont la hauteur suit jawOpen / pucker
  const mouthGeo = new THREE.CircleGeometry(0.045, 32);
  const mouth = meshWithMorphs(mouthGeo, mouthMat, {
    jawOpen: (x, y) => [0, y * 2.2 - 0.03, 0],
    mouthPucker: (x, y) => [-x * 0.5, y * 0.3, 0],
    mouthFunnel: (x, y) => [-x * 0.25, y * 0.4, 0],
    mouthSmileLeft: (x) => [x > 0 ? 0.012 : 0, x > 0 ? 0.012 : 0, 0],
    mouthSmileRight: (x) => [x < 0 ? -0.012 : 0, x < 0 ? 0.012 : 0, 0],
  });
  mouth.scale.set(1, 0.35, 1);
  mouth.position.set(0, 0.2 - 0.075, R - 0.003);
  mouth.castShadow = false;
  head.add(mouth);

  // yeux : blanc + pupille, clignement par écrasement vertical
  for (const side of ["Left", "Right"] as const) {
    const s = side === "Left" ? 1 : -1;
    const eyeGeo = new THREE.SphereGeometry(0.036, 24, 16);
    const eye = meshWithMorphs(eyeGeo, white, { [`eyeBlink${side}`]: (x, y) => [0, -y * 0.92, 0], [`eyeWide${side}`]: (x, y) => [0, y * 0.25, 0] });
    eye.position.set(s * 0.075, 0.2 + 0.045, R - 0.012);
    eye.castShadow = false;
    head.add(eye);
    const pupilGeo = new THREE.SphereGeometry(0.016, 16, 12);
    const pupil = meshWithMorphs(pupilGeo, dark, {
      [`eyeBlink${side}`]: (x, y) => [0, -y * 0.92, 0],
      [`eyeLookIn${side}`]: () => [-s * 0.012, 0, 0],
      [`eyeLookOut${side}`]: () => [s * 0.012, 0, 0],
      [`eyeLookUp${side}`]: () => [0, 0.01, 0],
      [`eyeLookDown${side}`]: () => [0, -0.01, 0],
    });
    pupil.position.set(s * 0.075, 0.2 + 0.045, R + 0.018);
    pupil.castShadow = false;
    head.add(pupil);
    // sourcil
    const browGeo = new THREE.BoxGeometry(0.06, 0.012, 0.015);
    const brow = meshWithMorphs(browGeo, dark, {
      browInnerUp: (x) => [0, 0.018 * smooth((s * -x + 0.03) / 0.06), 0],
      [`browOuterUp${side}`]: (x) => [0, 0.018 * smooth((s * x + 0.03) / 0.06), 0],
      [`browDown${side}`]: () => [0, -0.012, 0],
    });
    brow.position.set(s * 0.075, 0.2 + 0.095, R - 0.03);
    brow.rotation.z = -s * 0.12;
    head.add(brow);
  }

  // cheveux / calotte
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.205, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.33), dark);
  hair.position.y = 0.2 + 0.02;
  hair.castShadow = true;
  head.add(hair);

  root.updateMatrixWorld(true);
  return root;
}
