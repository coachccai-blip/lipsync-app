import { describe, expect, it } from "vitest";
import { parseScript, tagsToTracks } from "../src/tags.js";

const vocab = { emotions: ["neutre", "enjoué", "sérieux"], gestures: ["salut", "index"] };

describe("balises de jeu", () => {
  it("retire les balises et les rattache au mot suivant", () => {
    const r = parseScript("[enjoué] Bonjour à tous ! [geste:salut] Aujourd'hui, on parle. [sérieux] Attention. [geste:index]", vocab);
    expect(r.text).toBe("Bonjour à tous ! Aujourd'hui, on parle. Attention.");
    expect(r.words).toHaveLength(8);
    expect(r.tags).toEqual([
      { kind: "emotion", emotion: "enjoué", wordIndex: 0 },
      { kind: "gesture", gesture: "salut", wordIndex: 4 },
      { kind: "emotion", emotion: "sérieux", wordIndex: 7 },
      { kind: "gesture", gesture: "index", wordIndex: 7 },
    ]);
    expect(r.warnings).toEqual([]);
  });

  it("avertit sur une balise inconnue sans échouer", () => {
    const r = parseScript("[furieux] Salut [geste:danse] toi", vocab);
    expect(r.text).toBe("Salut toi");
    expect(r.tags).toEqual([]);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toContain("neutre, enjoué, sérieux");
    expect(r.warnings[1]).toContain("salut, index");
  });

  it("conserve les paragraphes", () => {
    const r = parseScript("Un.\n\n[enjoué] Deux.", vocab);
    expect(r.text).toBe("Un.\n\nDeux.");
    expect(r.tags[0].wordIndex).toBe(1);
  });

  it("convertit les balises en pistes temporelles", () => {
    const r = parseScript("[enjoué] Bonjour tout le monde. [sérieux] Attention [geste:index] ici.", vocab);
    const words = r.words.map((w, i) => ({ w, start: i, end: i + 0.8 }));
    const tracks = tagsToTracks(r.tags, words, 10);
    expect(tracks.expressions).toEqual([
      { start: 0, end: 4, emotion: "enjoué", intensity: 0.8, source: "balise" },
      { start: 4, end: 10, emotion: "sérieux", intensity: 0.8, source: "balise" },
    ]);
    expect(tracks.gestures).toEqual([{ at: 5, clip: "index", source: "balise" }]);
  });
});
