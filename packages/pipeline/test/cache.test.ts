import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cachedStep, hashInputs } from "../src/cache.js";

describe("cache par étape", () => {
  it("ne recalcule que si le hash change ou si une sortie manque", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "avatar-cache-"));
    const out = path.join(dir, "out.txt");
    let calls = 0;
    const fn = async () => {
      calls++;
      writeFileSync(out, "x");
      return { calls };
    };
    const a = await cachedStep(dir, "step", "h1", [out], fn);
    const b = await cachedStep(dir, "step", "h1", [out], fn);
    expect(a.fromCache).toBe(false);
    expect(b.fromCache).toBe(true);
    expect(calls).toBe(1);
    await cachedStep(dir, "step", "h2", [out], fn);
    expect(calls).toBe(2);
    writeFileSync(out, "");
    await cachedStep(dir, "step", "h2", [out], fn);
    expect(calls).toBe(3);
    await cachedStep(dir, "step", "h2", [out], fn, { force: true });
    expect(calls).toBe(4);
  });

  it("hash stable des entrées", () => {
    expect(hashInputs([{ text: "a" }])).toBe(hashInputs([{ text: "a" }]));
    expect(hashInputs([{ text: "a" }])).not.toBe(hashInputs([{ text: "b" }]));
  });
});
