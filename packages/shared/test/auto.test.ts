import { describe, expect, it } from "vitest";
import { autoTracks, sentencesFromSilences, splitSentences } from "../src/anim/auto.js";
import { makeTestPerformance } from "../src/demo.js";
import type { Performance } from "../src/types.js";

const vocab = { emotions: ["neutre", "enjoué", "sérieux", "surpris", "inquiet", "complice", "enthousiaste", "pensif"], gestures: ["salut", "explication", "index", "haussement_epaules", "mains_ouvertes", "acquiescement", "negation", "reflexion"] };

function speech(): Performance {
  const text = "Bonjour à tous et bienvenue ! Aujourd'hui nous allons parler d'un sujet important . Vous êtes prêts ? Alors commençons tout de suite par le premier point qui est essentiel .";
  const words = text.split(" ").map((w, i) => ({ w, start: 0.5 + i * 0.42, end: 0.5 + i * 0.42 + 0.36 }));
  const duration = words[words.length - 1].end + 0.6;
  const perf = makeTestPerformance(duration, 30, 7, true);
  delete (perf as Performance & { test?: boolean }).test;
  perf.words = words;
  perf.accents = words.filter((_, i) => i % 3 === 0).map((w) => w.start);
  return perf;
}

describe("pistes automatiques sans LLM", () => {
  it("couvre toute la parole avec des émotions et des gestes espacés", () => {
    const perf = speech();
    const r = autoTracks(perf, vocab);
    expect(r.expressions.length).toBeGreaterThanOrEqual(2);
    for (const e of r.expressions) {
      expect(vocab.emotions).toContain(e.emotion);
      expect(e.end).toBeGreaterThan(e.start);
      expect(e.source).toBe("procedural");
    }
    // la question reçoit une émotion de question
    const question = splitSentences(perf.words).find((s) => s.text.endsWith("?"))!;
    const atQuestion = r.expressions.find((e) => e.start <= question.start + 0.2 && e.end >= question.end - 0.3);
    expect(atQuestion && ["surpris", "complice", "pensif"].includes(atQuestion.emotion)).toBe(true);
    expect(r.gestures[0]).toMatchObject({ clip: "salut" });
    for (let i = 1; i < r.gestures.length; i++) expect(r.gestures[i].at - r.gestures[i - 1].at).toBeGreaterThanOrEqual(2.4);
    expect(r.gestures.length).toBeGreaterThanOrEqual(3);
  });

  it("est déterministe et respecte le vocabulaire", () => {
    const perf = speech();
    expect(autoTracks(perf, vocab)).toEqual(autoTracks(perf, vocab));
    const small = autoTracks(perf, { emotions: ["neutre", "sérieux"], gestures: ["index"] });
    for (const e of small.expressions) expect(e.emotion).toBe("sérieux");
    for (const g of small.gestures) expect(g.clip).toBe("index");
  });

  it("segmente par les silences quand il n'y a pas de mots", () => {
    const visemes = [
      { start: 0, end: 0.5, shape: "X" as const },
      { start: 0.5, end: 2, shape: "D" as const },
      { start: 2, end: 2.6, shape: "X" as const },
      { start: 2.6, end: 4, shape: "C" as const },
      { start: 4, end: 5, shape: "X" as const },
    ];
    const s = sentencesFromSilences(visemes, 5);
    expect(s.map((x) => [x.start, x.end])).toEqual([[0.5, 2], [2.6, 4]]);
    const perf = makeTestPerformance(5, 30, 3, true);
    perf.words = [];
    perf.visemes = visemes;
    const r = autoTracks(perf, vocab);
    expect(r.expressions.length + r.gestures.length).toBeGreaterThan(0);
  });
});
