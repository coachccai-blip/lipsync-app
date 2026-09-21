import { describe, expect, it } from "vitest";
import { parseRhubarb } from "../src/rhubarb.js";
import { parseWhisperJson } from "../src/transcribe/whisper-cpp.js";

describe("sortie Rhubarb", () => {
  it("convertit mouthCues en visèmes triés", () => {
    const json = JSON.stringify({ metadata: { duration: 1 }, mouthCues: [{ start: 0.5, end: 1, value: "X" }, { start: 0, end: 0.5, value: "D" }, { start: 1, end: 1, value: "A" }] });
    expect(parseRhubarb(json)).toEqual([
      { start: 0, end: 0.5, shape: "D" },
      { start: 0.5, end: 1, shape: "X" },
    ]);
  });
  it("rejette une sortie invalide", () => {
    expect(() => parseRhubarb("{}")).toThrow(/mouthCues/);
  });
});

describe("sortie whisper.cpp", () => {
  it("produit un mot par segment et rattache la ponctuation", () => {
    const json = JSON.stringify({
      transcription: [
        { offsets: { from: 500, to: 900 }, text: " Bonjour" },
        { offsets: { from: 900, to: 950 }, text: "," },
        { offsets: { from: 1000, to: 1600 }, text: " tout le" },
      ],
      result: { language: "fr" },
    });
    const r = parseWhisperJson(json);
    expect(r.language).toBe("fr");
    expect(r.words).toEqual([
      { w: "Bonjour,", start: 0.5, end: 0.9 },
      { w: "tout", start: 1, end: 1.4 },
      { w: "le", start: 1.4, end: 1.6 },
    ]);
    expect(r.text).toBe("Bonjour, tout le");
  });
});
