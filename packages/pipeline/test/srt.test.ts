import { describe, expect, it } from "vitest";
import { wordsToSrt } from "../src/srt.js";

describe("export SRT", () => {
  it("coupe sur la ponctuation, la longueur et la durée", () => {
    const words = "Bonjour à tous ! Aujourd'hui nous allons parler d'un sujet vraiment très important pour vous. Merci".split(" ").map((w, i) => ({ w, start: i * 0.4, end: i * 0.4 + 0.35 }));
    const srt = wordsToSrt(words, { maxChars: 30, maxDuration: 3 });
    const blocks = srt.trim().split("\n\n");
    expect(blocks[0]).toBe("1\n00:00:00,000 --> 00:00:01,550\nBonjour à tous !");
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    for (const b of blocks) expect(b.split("\n")[2].length).toBeLessThanOrEqual(30);
  });

  it("applique un décalage et évite les chevauchements", () => {
    const srt = wordsToSrt([{ w: "Un.", start: 0.5, end: 0.6 }, { w: "Deux.", start: 0.8, end: 1.2 }], { offset: -0.5 });
    expect(srt).toContain("00:00:00,000 --> 00:00:00,300");
    expect(srt).toContain("00:00:00,300 --> 00:00:00,800");
  });
});
