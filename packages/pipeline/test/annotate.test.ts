import { describe, expect, it } from "vitest";
import { annotationToTracks, buildPrompt } from "../src/annotate.js";
import { splitSentences } from "../src/align.js";
import { AzureTtsProvider } from "../src/tts/azure.js";

const vocab = { emotions: ["neutre", "enjoué", "sérieux"], gestures: ["salut", "index"] };
const words = "Bonjour à tous ! Aujourd'hui un point important . Merci .".split(" ").map((w, i) => ({ w, start: i, end: i + 0.9 }));
const sentences = splitSentences(words);

describe("annotation LLM", () => {
  it("le prompt contient le vocabulaire fermé et la consigne de sobriété", () => {
    const p = buildPrompt([{ index: 0, start: 0, end: 1, text: "Bonjour" }], vocab);
    expect(p.system).toContain("neutre, enjoué, sérieux");
    expect(p.system).toContain("salut, index");
    expect(p.system).toMatch(/4 à 6 secondes/);
    expect(p.user).toContain("0. [0.00 → 1.00] Bonjour");
  });

  it("convertit en pistes, filtre le vocabulaire et espace les gestes", () => {
    const warnings: string[] = [];
    const r = annotationToTracks(
      {
        sentences: [
          { index: 0, emotion: "enjoué", intensity: 0.8 },
          { index: 1, emotion: "sérieux", intensity: 0.6 },
          { index: 2, emotion: "furieux", intensity: 1 },
        ],
        gestures: [
          { sentence: 0, word: "Bonjour", clip: "salut" },
          { sentence: 0, word: "tous", clip: "index" },
          { sentence: 1, word: "important", clip: "index" },
          { sentence: 2, word: "Merci", clip: "danse" },
        ],
      },
      sentences,
      vocab,
      { warn: (m) => warnings.push(m), minGestureGap: 4 },
    );
    expect(r.expressions).toEqual([
      { start: 0, end: 3.9, emotion: "enjoué", intensity: 0.8, source: "llm" },
      { start: 4, end: 8.9, emotion: "sérieux", intensity: 0.6, source: "llm" },
    ]);
    expect(r.gestures).toEqual([
      { at: 0, clip: "salut", source: "llm" },
      { at: 7, clip: "index", source: "llm" },
    ]);
    expect(warnings).toHaveLength(2);
  });
});

describe("Azure TTS", () => {
  it("génère un SSML minimal avec la température HD", () => {
    const p = new AzureTtsProvider({ key: "k", region: "westeurope", temperature: 0.4 });
    const s = p.ssml("Bonjour <tous> & bienvenue");
    expect(s).toContain('<voice name="fr-FR-Vivienne:DragonHDLatestNeural" parameters="temperature=0.4">');
    expect(s).toContain("Bonjour &lt;tous&gt; &amp; bienvenue");
    expect(s).not.toContain("<prosody");
  });

  it("vérifie l'existence de la voix dans la région", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify([{ ShortName: "fr-FR-DeniseNeural", Locale: "fr-FR" }, { ShortName: "en-US-Ava:DragonHDLatestNeural", Locale: "en-US" }]), { status: 200 })) as unknown as typeof fetch;
    const p = new AzureTtsProvider({ key: "k", region: "francecentral", fetchImpl });
    await expect(p.check()).rejects.toThrow(/n'existe pas dans la région Azure « francecentral »[\s\S]*en-US-Ava:DragonHDLatestNeural[\s\S]*fr-FR-DeniseNeural/);
  });

  it("concatène les paragraphes avec un silence et réessaie sur erreur réseau", async () => {
    let calls = 0;
    const fetchImpl = (async (url: string) => {
      if (String(url).endsWith("/voices/list")) return new Response(JSON.stringify([{ ShortName: "fr-FR-Vivienne:DragonHDLatestNeural", Locale: "fr-FR" }]));
      calls++;
      if (calls === 1) return new Response("", { status: 503 });
      return new Response(Buffer.alloc(96000), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new AzureTtsProvider({ key: "k", region: "westeurope", fetchImpl, paragraphGapMs: 100 });
    await p.check();
    const r = await p.synthesize("Un.\n\nDeux.");
    expect(r.sampleRate).toBe(48000);
    expect(r.pcm.length).toBe(96000 * 2 + 9600);
    expect(calls).toBe(3);
  }, 15000);
});
