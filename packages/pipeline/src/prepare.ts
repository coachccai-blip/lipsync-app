import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { approximateLipsync, autoTracks, type AllConfig, type ExpressionSegment, type GestureEvent, type Performance, type VisemeCue, type Word } from "@avatar/shared";
import { audioDuration, normalizeAudio, pcmToWav, readWav } from "./audio.js";
import { cachedStep, hashInputs } from "./cache.js";
import { configVocab, loadConfig } from "./config.js";
import { analyzeEnergy } from "./energy.js";
import { log } from "./log.js";
import { PROJECT_FILES, ensureProjectDir, loadPerformance, readMeta, writeMeta, writePerformance } from "./project.js";
import { runRhubarb } from "./rhubarb.js";
import { alignScriptToAsr, splitSentences } from "./align.js";
import { parseScript, tagsToTracks, type ScriptTag } from "./tags.js";
import { AnthropicAnnotator, annotationToTracks, type Annotator } from "./annotate.js";
import { WhisperCppTranscriber } from "./transcribe/whisper-cpp.js";
import type { Transcriber, Transcription } from "./transcribe/transcriber.js";
import { AzureTtsProvider } from "./tts/azure.js";
import type { TtsProvider } from "./tts/provider.js";

export interface PrepareOptions {
  audio?: string;
  texte?: string;
  out: string;
  sansLlm?: boolean;
  seed?: number;
  fps?: number;
  /** Ignore le cache et recalcule tout. */
  force?: boolean;
  language?: string;
  /** Injections (tests, autres fournisseurs). */
  tts?: TtsProvider;
  transcriber?: Transcriber;
  annotator?: Annotator;
  lipsync?: (wav: string, outputJson: string) => Promise<VisemeCue[]>;
  config?: AllConfig;
  root?: string;
  /** Annulation (vérifiée entre les étapes ; l'étape en cours va à son terme). */
  signal?: AbortSignal;
  /**
   * Préparation rapide : ni Whisper ni Rhubarb. Lip sync approximatif calculé depuis
   * l'audio (énergie et centre spectral), pas de mots ; ffmpeg reste nécessaire.
   */
  rapide?: boolean;
}

export interface PrepareResult {
  performance: Performance;
  projectDir: string;
  warnings: string[];
}

const tokenize = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/** Les segments prioritaires (balises) découpent les segments de base (LLM). */
export function overrideSegments(base: ExpressionSegment[], priority: ExpressionSegment[]): ExpressionSegment[] {
  let out = [...base];
  for (const p of priority) {
    const next: ExpressionSegment[] = [];
    for (const b of out) {
      if (b.end <= p.start || b.start >= p.end) {
        next.push(b);
        continue;
      }
      if (b.start < p.start) next.push({ ...b, end: p.start });
      if (b.end > p.end) next.push({ ...b, start: p.end });
    }
    out = next;
  }
  // les résidus trop courts de segments découpés sont retirés
  return [...out.filter((s) => s.end - s.start >= 0.4), ...priority].filter((s) => s.end - s.start > 0.05).sort((a, b) => a.start - b.start);
}

/** Les gestes de balises sont prioritaires : un geste LLM trop proche est écarté. */
export function mergeGestures(auto: GestureEvent[], manual: GestureEvent[], minGap = 2): GestureEvent[] {
  const kept = auto.filter((g) => !manual.some((m) => Math.abs(m.at - g.at) < minGap));
  return [...manual, ...kept].sort((a, b) => a.at - b.at);
}

/**
 * `avatar prepare` : produit le dossier projet (audio normalisé, transcript.txt,
 * performance.json). Chaque étape est mise en cache et n'est recalculée que si son
 * entrée a changé.
 */
export async function prepare(options: PrepareOptions): Promise<PrepareResult> {
  if (!options.audio && !options.texte) throw new Error("Indiquez --audio <fichier> ou --texte <fichier>.");
  if (options.audio && options.texte) throw new Error("--audio et --texte sont exclusifs.");
  const projectDir = path.resolve(options.out);
  ensureProjectDir(projectDir);
  const cfg = options.config ?? loadConfig(options.root);
  const vocab = configVocab(cfg);
  const fps = options.fps ?? cfg.scene.fps;
  const language = options.language ?? "fr";
  const warnings: string[] = [];
  const warn = (m: string) => {
    warnings.push(m);
    log.warn(m);
  };
  const force = options.force ?? false;
  const checkAbort = () => {
    if (options.signal?.aborted) throw new Error("Préparation annulée");
  };
  const mode: "audio" | "texte" = options.audio ? "audio" : "texte";
  const inputFile = path.resolve((options.audio ?? options.texte)!);
  if (!existsSync(inputFile)) throw new Error(`Fichier d'entrée introuvable : ${inputFile}`);

  const previous = existsSync(path.join(projectDir, PROJECT_FILES.performance)) ? safeLoadPrevious(projectDir) : undefined;
  const seed = options.seed ?? previous?.seed ?? 12345;
  const meta = readMeta(projectDir);
  writeMeta(projectDir, { mode, input: inputFile, createdAt: meta?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() });

  const sourceCopy = path.join(projectDir, "source", path.basename(inputFile));
  copyFileSync(inputFile, sourceCopy);

  // ---- 1. Texte / balises / synthèse vocale (mode B) ----
  let rawAudio: string;
  let scriptText: string | undefined;
  let tags: ScriptTag[] = [];
  if (mode === "texte") {
    log.step("Lecture du script et extraction des balises");
    const parsed = parseScript(readFileSync(inputFile, "utf8"), vocab);
    parsed.warnings.forEach(warn);
    scriptText = parsed.text;
    tags = parsed.tags;
    writeFileSync(path.join(projectDir, PROJECT_FILES.script), parsed.text);
    log.info(`${parsed.words.length} mots, ${tags.length} balise(s)`);

    const tts = options.tts ?? new AzureTtsProvider();
    const ttsWav = path.join(projectDir, "cache", "tts.wav");
    log.step(`Synthèse vocale (${tts.name})`);
    await cachedStep(projectDir, "tts", hashInputs([{ text: parsed.text }, { text: tts.configKey() }]), [ttsWav], async () => {
      await tts.check();
      const r = await tts.synthesize(parsed.text);
      writeFileSync(ttsWav, pcmToWav(r.pcm, r.sampleRate, 1));
      return { sampleRate: r.sampleRate, bytes: r.pcm.length };
    }, { force });
    rawAudio = ttsWav;
  } else {
    rawAudio = sourceCopy;
  }

  checkAbort();
  // ---- 2. Normalisation ----
  const audioWav = path.join(projectDir, PROJECT_FILES.audio);
  const padding = cfg.scene.padding;
  log.step("Normalisation audio (WAV mono 48 kHz, loudnorm, silences de repos)");
  await cachedStep(projectDir, "normalize", hashInputs([{ file: rawAudio }, { text: JSON.stringify(padding) }]), [audioWav], async () => {
    await normalizeAudio(rawAudio, audioWav, { padBefore: padding.before, padAfter: padding.after });
    return { padding };
  }, { force });
  const duration = round3(await audioDuration(audioWav));
  log.info(`durée : ${duration.toFixed(2)} s`);

  checkAbort();
  // ---- 3. Transcription (Whisper) ----
  const transcriber = options.transcriber ?? new WhisperCppTranscriber();
  let asr: Transcription = { text: "", words: [] };
  if (options.rapide) {
    log.step("Préparation rapide : pas de transcription (aucun mot), lip sync approximatif");
  } else {
    log.step(`Transcription et horodatage des mots (${transcriber.name})`);
    asr = (
      await cachedStep<Transcription>(
        projectDir,
        "transcribe",
        hashInputs([{ file: audioWav }, { text: transcriber.name }, { text: language }]),
        [],
        () => transcriber.transcribe(audioWav, { language, workDir: path.join(projectDir, "cache") }),
        { force },
      )
    ).result;
    log.info(`${asr.words.length} mots reconnus`);
  }

  checkAbort();
  // ---- 4. Texte de référence et alignement ----
  let words: Word[];
  let text: string;
  const transcriptFile = path.join(projectDir, PROJECT_FILES.transcript);
  const generatedFile = path.join(projectDir, "cache", "transcript.generated.txt");
  if (options.rapide) {
    words = mode === "texte" ? tokenize(scriptText!).map((w) => ({ w, start: 0, end: 0 })) : [];
    text = mode === "texte" ? scriptText! : "";
    if (mode === "texte") {
      // sans horodatage : mots répartis uniformément sur la parole (approximation)
      const span = Math.max(0.1, duration - padding.before - padding.after);
      words = words.map((w, i) => ({ w: w.w, start: round3(padding.before + (span * i) / words.length), end: round3(padding.before + (span * (i + 1)) / words.length) }));
    }
  } else if (mode === "audio") {
    const generated = asr.text;
    const previousGenerated = existsSync(generatedFile) ? readFileSync(generatedFile, "utf8") : undefined;
    writeFileSync(generatedFile, generated);
    const current = existsSync(transcriptFile) ? readFileSync(transcriptFile, "utf8") : undefined;
    const userEdited = current !== undefined && current.trim() !== generated.trim() && current.trim() !== previousGenerated?.trim();
    if (userEdited) {
      log.step("transcript.txt modifié : réalignement sur le texte corrigé");
      const scriptWords = tokenize(current!);
      const aligned = alignScriptToAsr(scriptWords, asr.words, duration);
      log.info(`${aligned.matched}/${scriptWords.length} mots alignés directement, le reste interpolé`);
      words = aligned.words;
      text = current!.trim();
    } else {
      writeFileSync(transcriptFile, generated + "\n");
      words = asr.words;
      text = generated;
    }
  } else {
    log.step("Réalignement script ↔ Whisper");
    const scriptWords = tokenize(scriptText!);
    const aligned = alignScriptToAsr(scriptWords, asr.words, duration);
    const ratio = scriptWords.length ? aligned.matched / scriptWords.length : 1;
    log.info(`${aligned.matched}/${scriptWords.length} mots alignés directement (${Math.round(ratio * 100)} %)`);
    if (ratio < 0.6) warn(`alignement faible (${Math.round(ratio * 100)} %) : vérifiez que l'audio correspond bien au script`);
    words = aligned.words;
    text = scriptText!;
  }
  writeFileSync(path.join(projectDir, PROJECT_FILES.words), JSON.stringify(words, null, 1));

  checkAbort();
  // ---- 5. Lip sync (Rhubarb) ----
  const visemesFile = path.join(projectDir, PROJECT_FILES.visemes);
  log.step(options.rapide ? "Lip sync approximatif (énergie et spectre)" : "Lip sync (Rhubarb, reconnaisseur phonétique)");
  const wavData = readWav(audioWav);
  const { result: visemes } = await cachedStep<VisemeCue[]>(projectDir, options.rapide ? "lipsync-approx" : "rhubarb", hashInputs([{ file: audioWav }]), [visemesFile], async () => {
    if (options.rapide) {
      const cues = approximateLipsync(wavData.samples, wavData.sampleRate);
      writeFileSync(visemesFile, JSON.stringify({ metadata: { approximatif: true }, mouthCues: cues.map((c) => ({ start: c.start, end: c.end, value: c.shape })) }));
      return cues;
    }
    return (options.lipsync ?? runRhubarb)(audioWav, visemesFile);
  }, { force });
  log.info(`${visemes.length} visèmes`);

  checkAbort();
  // ---- 6. Énergie ----
  log.step("Analyse d'énergie");
  const energy = analyzeEnergy(wavData.samples, wavData.sampleRate, { rate: fps });
  log.info(`${energy.accents.length} accents détectés`);

  checkAbort();
  // ---- 7. Expressions et gestes ----
  const sentences = splitSentences(words);
  const tagTracks = tagsToTracks(tags, words, duration);
  let llmTracks: { expressions: ExpressionSegment[]; gestures: GestureEvent[] } = { expressions: [], gestures: [] };
  if (!options.sansLlm) {
    const annotator = options.annotator ?? (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? new AnthropicAnnotator() : undefined);
    if (!annotator) {
      warn("ANTHROPIC_API_KEY absent : pas d'annotation LLM (équivalent à --sans-llm)");
    } else {
      log.step(`Annotation des expressions et gestes (${annotator.name})`);
      const inputs = sentences.map((s, index) => ({ index, start: s.start, end: s.end, text: s.text }));
      const { result: annotation } = await cachedStep(
        projectDir,
        "annotate",
        hashInputs([{ text: JSON.stringify(inputs) }, { text: annotator.name }, { text: JSON.stringify(vocab) }]),
        [],
        () => annotator.annotate(inputs, vocab),
        { force },
      );
      llmTracks = annotationToTracks(annotation, sentences, vocab, { warn });
      log.info(`${llmTracks.expressions.length} segment(s) d'émotion, ${llmTracks.gestures.length} geste(s)`);
    }
  }
  if (llmTracks.expressions.length === 0 && llmTracks.gestures.length === 0) {
    log.step("Émotions et gestes procéduraux (énergie, accents, phrases) sur toute la durée");
    const draft: Performance = { version: 1, fps, duration, audio: PROJECT_FILES.audio, text, words, visemes, energy: energy.energy, accents: energy.accents, expressions: [], gestures: [], seed };
    llmTracks = autoTracks(draft, vocab);
    log.info(`${llmTracks.expressions.length} segment(s) d'émotion, ${llmTracks.gestures.length} geste(s)`);
  }
  const expressions = overrideSegments(llmTracks.expressions, tagTracks.expressions);
  const gestures = mergeGestures(llmTracks.gestures, tagTracks.gestures);

  checkAbort();
  // ---- 8. performance.json ----
  const performance: Performance = {
    version: 1,
    fps,
    duration,
    audio: PROJECT_FILES.audio,
    text,
    words,
    visemes,
    energy: energy.energy,
    accents: energy.accents,
    expressions,
    gestures,
    seed,
    padding,
  };
  const file = writePerformance(projectDir, performance);
  loadPerformance(projectDir, vocab); // validation immédiate
  log.done(`performance.json écrit : ${file}`);
  return { performance, projectDir, warnings };
}

function safeLoadPrevious(dir: string): Performance | undefined {
  try {
    return loadPerformance(dir);
  } catch {
    return undefined;
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
