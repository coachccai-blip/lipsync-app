import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeEnergy, resample, rmsEnvelope } from "../src/energy.js";
import { readWav } from "../src/audio.js";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures/reference.wav");

describe("analyse d'énergie", () => {
  it("calcule une enveloppe RMS par fenêtres de 20 ms", () => {
    const sr = 1000;
    const s = new Float32Array(sr);
    for (let i = 500; i < 1000; i++) s[i] = 0.5;
    const env = rmsEnvelope(s, sr, 0.02);
    expect(env.values).toHaveLength(50);
    expect(env.values[0]).toBe(0);
    expect(env.values[40]).toBeCloseTo(0.5, 5);
  });

  it("rééchantillonne à la cadence vidéo", () => {
    expect(resample([0, 1], 1, 4, 1)).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it("détecte les accents du WAV de référence", () => {
    const wav = readWav(fixture);
    const r = analyzeEnergy(wav.samples, wav.sampleRate, { rate: 30 });
    expect(r.energy.rate).toBe(30);
    expect(r.energy.values).toHaveLength(Math.ceil(wav.duration * 30));
    expect(Math.max(...r.energy.values)).toBeLessThanOrEqual(1);
    expect(Math.min(...r.energy.values)).toBeGreaterThanOrEqual(0);
    // pics attendus près du milieu des syllabes fortes (0,425 s ; 1,35 s)
    expect(r.accents.some((a) => Math.abs(a - 0.425) < 0.08)).toBe(true);
    expect(r.accents.some((a) => Math.abs(a - 1.35) < 0.08)).toBe(true);
    for (let i = 1; i < r.accents.length; i++) expect(r.accents[i] - r.accents[i - 1]).toBeGreaterThanOrEqual(0.35);
  });
});
