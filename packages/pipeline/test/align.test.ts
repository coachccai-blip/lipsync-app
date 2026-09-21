import { describe, expect, it } from "vitest";
import { alignScriptToAsr, alignSequences, normalizeToken, splitSentences } from "../src/align.js";

describe("alignement script ↔ Whisper", () => {
  it("normalise accents, casse et ponctuation", () => {
    expect(normalizeToken("Élève,")).toBe("eleve");
    expect(normalizeToken("«Bonjour»")).toBe("bonjour");
  });

  it("aligne malgré des écarts (chiffres, mots manquants ou en trop)", () => {
    const script = ["Bonjour", "à", "tous,", "nous", "avons", "3", "points", "à", "voir."];
    const asr = ["bonjour", "à", "tous", "nous", "avons", "trois", "points", "euh", "à", "voir"];
    const m = alignSequences(script, asr);
    expect(m).toEqual([0, 1, 2, 3, 4, -1, 6, 8, 9]);
  });

  it("reporte les temps et interpole les mots sans correspondance", () => {
    const script = ["Bonjour", "à", "tous", "3", "points"];
    const asr = [
      { w: "bonjour", start: 0.5, end: 0.9 },
      { w: "à", start: 0.9, end: 1.0 },
      { w: "tous", start: 1.0, end: 1.3 },
      { w: "trois", start: 1.4, end: 1.7 },
      { w: "points", start: 1.7, end: 2.1 },
    ];
    const r = alignScriptToAsr(script, asr, 3);
    expect(r.matched).toBe(4);
    expect(r.words[3]).toEqual({ w: "3", start: 1.3, end: 1.7 });
    expect(r.words[4].start).toBe(1.7);
    for (let i = 1; i < r.words.length; i++) expect(r.words[i].start).toBeGreaterThanOrEqual(r.words[i - 1].end);
  });

  it("interpole un début et une fin sans correspondance", () => {
    const script = ["Euh", "bonjour", "hein"];
    const asr = [{ w: "bonjour", start: 1, end: 1.5 }];
    const r = alignScriptToAsr(script, asr, 3);
    expect(r.words[0].start).toBe(1);
    expect(r.words[0].end).toBe(1);
    expect(r.words[2].start).toBe(1.5);
    expect(r.words[2].end).toBe(1.5);
  });

  it("découpe en phrases sur la ponctuation forte", () => {
    const words = ["Bonjour", "à", "tous !", "Ça", "va ?", "Oui."].map((w, i) => ({ w, start: i, end: i + 1 }));
    const s = splitSentences(words);
    expect(s.map((x) => x.text)).toEqual(["Bonjour à tous !", "Ça va ?", "Oui."]);
    expect(s[1].start).toBe(3);
    expect(s[1].end).toBe(5);
  });
});
