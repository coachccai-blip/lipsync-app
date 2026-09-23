import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, validatePerformance } from "@avatar/shared";
import { mergeGestures, overrideSegments, prepare } from "../src/prepare.js";
import { readWav } from "../src/audio.js";
import type { Transcriber } from "../src/transcribe/transcriber.js";
import type { TtsProvider } from "../src/tts/provider.js";
import type { Annotator } from "../src/annotate.js";
import { resolveTool } from "../src/tools.js";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures/reference.wav");

let hasFfmpeg = true;
beforeAll(() => {
  try {
    resolveTool("ffmpeg");
  } catch {
    hasFfmpeg = false;
  }
});

/** Transcripteur simulé : quatre mots sur les quatre syllabes du WAV (décalés du silence initial). */
function fakeTranscriber(pad: number): Transcriber & { calls: number } {
  const t = {
    name: "fake-whisper",
    calls: 0,
    async transcribe() {
      t.calls++;
      const w = (word: string, s: number, e: number) => ({ w: word, start: s + pad, end: e + pad });
      return { text: "Bonjour à tous merci.", words: [w("Bonjour", 0.3, 0.55), w("à", 0.7, 0.95), w("tous", 1.2, 1.5), w("merci.", 1.8, 2.0)] };
    },
  };
  return t;
}

const fakeLipsync = async (wav: string, out: string) => {
  const cues = [
    { start: 0, end: 0.8, shape: "X" as const },
    { start: 0.8, end: 1.05, shape: "D" as const },
    { start: 1.05, end: 1.2, shape: "B" as const },
    { start: 1.2, end: 3.4, shape: "X" as const },
  ];
  writeFileSync(out, JSON.stringify({ mouthCues: cues.map((c) => ({ start: c.start, end: c.end, value: c.shape })) }));
  return cues;
};

const fakeAnnotator: Annotator = {
  name: "fake-llm",
  async annotate(sentences) {
    return { sentences: sentences.map((s) => ({ index: s.index, emotion: "enjoué", intensity: 0.7 })), gestures: [{ sentence: 0, word: "Bonjour", clip: "salut" }] };
  },
};

describe("fusion des pistes", () => {
  it("les balises découpent les segments LLM et écartent les gestes proches", () => {
    const llm = [{ start: 0, end: 10, emotion: "enjoué", intensity: 0.7, source: "llm" as const }];
    const tag = [{ start: 3, end: 5, emotion: "sérieux", intensity: 0.8, source: "balise" as const }];
    expect(overrideSegments(llm, tag)).toEqual([
      { start: 0, end: 3, emotion: "enjoué", intensity: 0.7, source: "llm" },
      { start: 3, end: 5, emotion: "sérieux", intensity: 0.8, source: "balise" },
      { start: 5, end: 10, emotion: "enjoué", intensity: 0.7, source: "llm" },
    ]);
    expect(mergeGestures([{ at: 1, clip: "index", source: "llm" }, { at: 6, clip: "index", source: "llm" }], [{ at: 1.5, clip: "salut", source: "balise" }])).toEqual([
      { at: 1.5, clip: "salut", source: "balise" },
      { at: 6, clip: "index", source: "llm" },
    ]);
  });
});

describe("avatar prepare (intégration, ffmpeg requis)", () => {
  it("mode A : produit un projet complet, puis réutilise le cache", async () => {
    if (!hasFfmpeg) return;
    const out = mkdtempSync(path.join(os.tmpdir(), "avatar-prepare-"));
    const transcriber = fakeTranscriber(DEFAULT_CONFIG.scene.padding.before);
    const opts = { audio: fixture, out, transcriber, lipsync: fakeLipsync, annotator: fakeAnnotator, config: DEFAULT_CONFIG };
    const r = await prepare(opts);
    const perf = r.performance;
    expect(existsSync(path.join(out, "audio.wav"))).toBe(true);
    expect(existsSync(path.join(out, "transcript.txt"))).toBe(true);
    expect(readFileSync(path.join(out, "transcript.txt"), "utf8").trim()).toBe("Bonjour à tous merci.");
    const wav = readWav(path.join(out, "audio.wav"));
    expect(wav.sampleRate).toBe(48000);
    expect(wav.channels).toBe(1);
    expect(perf.duration).toBeCloseTo(2.4 + 1.0, 1);
    expect(perf.words).toHaveLength(4);
    expect(perf.visemes.length).toBe(4);
    expect(perf.energy.rate).toBe(30);
    expect(perf.energy.values.length).toBe(Math.ceil(perf.duration * 30));
    expect(perf.expressions[0]).toMatchObject({ emotion: "enjoué", source: "llm" });
    expect(perf.gestures).toEqual([{ at: 0.8, clip: "salut", source: "llm" }]);
    expect(() => validatePerformance(JSON.parse(readFileSync(path.join(out, "performance.json"), "utf8")))).not.toThrow();

    const again = await prepare(opts);
    expect(transcriber.calls).toBe(1);
    expect(again.performance.seed).toBe(perf.seed);
  });

  it("mode A : un transcript.txt corrigé déclenche seulement le réalignement", async () => {
    if (!hasFfmpeg) return;
    const out = mkdtempSync(path.join(os.tmpdir(), "avatar-prepare-"));
    const transcriber = fakeTranscriber(DEFAULT_CONFIG.scene.padding.before);
    const opts = { audio: fixture, out, transcriber, lipsync: fakeLipsync, sansLlm: true, config: DEFAULT_CONFIG };
    await prepare(opts);
    writeFileSync(path.join(out, "transcript.txt"), "Bonjour à vous tous, merci !");
    const r = await prepare(opts);
    expect(transcriber.calls).toBe(1);
    expect(r.performance.text).toBe("Bonjour à vous tous, merci !");
    expect(r.performance.words.map((w) => w.w)).toEqual(["Bonjour", "à", "vous", "tous,", "merci", "!"]);
    expect(r.performance.words[0].start).toBe(0.8);
    expect(r.performance.words[3].start).toBe(1.7);
    // sans LLM : émotions et gestes procéduraux sur la durée de la parole
    expect(r.performance.expressions.length).toBeGreaterThan(0);
    expect(r.performance.expressions.every((e) => e.source === "procedural")).toBe(true);
  });

  it("mode B : balises, TTS simulée et réalignement", async () => {
    if (!hasFfmpeg) return;
    const out = mkdtempSync(path.join(os.tmpdir(), "avatar-prepare-"));
    const script = path.join(out, "script-source.txt");
    writeFileSync(script, "[enjoué] Bonjour à tous, [geste:index] merci. [inconnu] [sérieux] Fin.");
    const raw = readFileSync(fixture);
    const tts: TtsProvider & { calls: number } = {
      name: "fake-tts",
      calls: 0,
      configKey: () => "fake",
      async check() {},
      async synthesize() {
        tts.calls++;
        return { pcm: raw.subarray(44), sampleRate: 16000 };
      },
    };
    const transcriber = fakeTranscriber(DEFAULT_CONFIG.scene.padding.before);
    const r = await prepare({ texte: script, out, tts, transcriber, lipsync: fakeLipsync, sansLlm: true, config: DEFAULT_CONFIG });
    expect(r.warnings.some((w) => w.includes("[inconnu]"))).toBe(true);
    expect(r.performance.text).toBe("Bonjour à tous, merci. Fin.");
    expect(r.performance.words.map((w) => w.w)).toEqual(["Bonjour", "à", "tous,", "merci.", "Fin."]);
    expect(r.performance.words[3].start).toBe(2.3);
    expect(r.performance.gestures).toEqual([{ at: 2.3, clip: "index", source: "balise" }]);
    expect(r.performance.expressions.map((e) => e.emotion)).toEqual(["enjoué", "sérieux"]);
    expect(r.performance.expressions[0].start).toBe(0.8);
    expect(r.performance.expressions[1].start).toBeCloseTo(2.5, 5);
    await prepare({ texte: script, out, tts, transcriber, lipsync: fakeLipsync, sansLlm: true, config: DEFAULT_CONFIG });
    expect(tts.calls).toBe(1);
  });
});
