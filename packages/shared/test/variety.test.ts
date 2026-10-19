import { describe, expect, it } from "vitest";
import { autoTracks } from "../src/anim/auto.js";
import { lexicalEmotion, varyEmotions } from "../src/anim/variety.js";
import { makeTestPerformance } from "../src/demo.js";
import type { ExpressionSegment, Performance } from "../src/types.js";

const vocab = ["neutre", "enjoué", "sérieux", "surpris", "inquiet", "complice", "enthousiaste", "pensif"];

function longSpeech(seconds: number, sentenceEvery = 3): Performance {
  // phrases monotones de `sentenceEvery` s, toutes affirmatives, même énergie
  const words: Performance["words"] = [];
  let t = 0.5;
  let i = 0;
  while (t < seconds - 1) {
    const w = i % Math.round(sentenceEvery / 0.4) === Math.round(sentenceEvery / 0.4) - 1 ? "point." : "mot";
    words.push({ w, start: t, end: t + 0.3 });
    t += 0.4;
    i++;
  }
  const perf = makeTestPerformance(seconds, 30, 3, true);
  delete (perf as Performance & { test?: boolean }).test;
  perf.words = words;
  perf.accents = [];
  perf.energy = { rate: perf.energy.rate, values: perf.energy.values.map(() => 0.5) };
  return perf;
}

const longestRun = (segs: ExpressionSegment[]): number => {
  let best = 0;
  const s = [...segs].sort((a, b) => a.start - b.start);
  for (let i = 0; i < s.length; i++) {
    let end = s[i].end;
    let j = i + 1;
    while (j < s.length && s[j].emotion === s[i].emotion && s[j].start - end < 0.8) end = s[j++].end;
    best = Math.max(best, end - s[i].start);
  }
  return best;
};

describe("variété des émotions", () => {
  it("indices lexicaux", () => {
    expect(lexicalEmotion("C'est vraiment génial !", vocab)).toBe("enthousiaste");
    expect(lexicalEmotion("Attention, il y a un risque.", vocab)).toBe("inquiet");
    expect(lexicalEmotion("Vous êtes prêts ?", vocab)).toBe("surpris");
    expect(lexicalEmotion("Je pense que oui.", vocab)).toBe("pensif");
    expect(lexicalEmotion("Il faut respecter la règle.", vocab)).toBe("sérieux");
    expect(lexicalEmotion("Nous verrons cela.", vocab)).toBeUndefined();
  });

  it("découpe un segment de 60 s en morceaux de 10 s max, aux fins de phrases, sans deux voisins identiques", () => {
    const perf = longSpeech(60);
    const seg: ExpressionSegment = { start: 0.5, end: 59, emotion: "sérieux", intensity: 0.7, source: "llm" };
    const out = varyEmotions([seg], perf, vocab, { maxSegment: 10 });
    expect(out.length).toBeGreaterThanOrEqual(6);
    expect(longestRun(out)).toBeLessThanOrEqual(10.01);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].emotion).not.toBe(out[i - 1].emotion);
      expect(out[i].start).toBeGreaterThanOrEqual(out[i - 1].end);
      expect(vocab).toContain(out[i].emotion);
    }
    // coupes sur des fins de phrases (mot « point. »)
    const sentenceEnds = perf.words.filter((w) => w.w === "point.").map((w) => w.end);
    for (const o of out.slice(0, -1)) expect(sentenceEnds.some((e) => Math.abs(e - o.end) < 0.01)).toBe(true);
  });

  it("ne touche pas aux segments manuels ou de balises", () => {
    const perf = longSpeech(40);
    const manual: ExpressionSegment = { start: 1, end: 35, emotion: "enjoué", intensity: 1, source: "manuel" };
    const out = varyEmotions([manual], perf, vocab, { maxSegment: 10 });
    expect(out).toEqual([manual]);
  });

  it("autoTracks : jamais plus de 10 s de la même émotion sur un long discours monotone", () => {
    const perf = longSpeech(180);
    const r = autoTracks(perf, { emotions: vocab, gestures: ["explication", "acquiescement"] }, { maxSegment: 10 });
    expect(longestRun(r.expressions)).toBeLessThanOrEqual(10.01);
    expect(new Set(r.expressions.map((e) => e.emotion)).size).toBeGreaterThanOrEqual(3);
    expect(autoTracks(perf, { emotions: vocab, gestures: ["explication", "acquiescement"] }, { maxSegment: 10 })).toEqual(r);
  });
});
