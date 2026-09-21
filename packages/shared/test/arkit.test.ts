import { describe, expect, it } from "vitest";
import { normalizeName, resolveMorphTargets } from "../src/arkit.js";

describe("résolution des blendshapes", () => {
  it("normalise casse, séparateurs et préfixes", () => {
    expect(normalizeName("jawOpen")).toBe("jawopen");
    expect(normalizeName("JawOpen")).toBe("jawopen");
    expect(normalizeName("jaw_open")).toBe("jawopen");
    expect(normalizeName("CC_Base_Body.Jaw_Open")).toBe("jawopen");
    expect(normalizeName("blendShape1.mouth-Smile_Left")).toBe("mouthsmileleft");
  });

  it("résout les noms et rapporte les manquants", () => {
    const r = resolveMorphTargets(["Jaw_Open", "mouthSmile_L", "Truc"]);
    expect(r.indices.get("jawOpen")).toBe(0);
    expect(r.indices.get("mouthSmileLeft")).toBe(1);
    expect(r.unknown).toEqual(["Truc"]);
    expect(r.missing).toContain("eyeBlinkLeft");
    expect(r.missing).not.toContain("jawOpen");
  });
});
