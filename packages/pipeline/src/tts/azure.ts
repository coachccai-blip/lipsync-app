import type { TtsProvider, TtsResult } from "./provider.js";
import { log } from "../log.js";

export interface AzureTtsOptions {
  key?: string;
  region?: string;
  voice?: string;
  temperature?: number;
  language?: string;
  /** Silence entre deux paragraphes, en ms. */
  paragraphGapMs?: number;
  fetchImpl?: typeof fetch;
}

const SAMPLE_RATE = 48000;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Azure Speech via l'API REST. Voix HD (DragonHD) : pas d'événements de frontière de
 * mots ni de visèmes, SSML minimal (<speak>, <voice>, <break>). Les horodatages viennent
 * toujours de Whisper.
 */
export class AzureTtsProvider implements TtsProvider {
  readonly name = "azure";
  private readonly key: string;
  private readonly region: string;
  private readonly voice: string;
  private readonly temperature: number;
  private readonly language: string;
  private readonly gapMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AzureTtsOptions = {}) {
    this.key = options.key ?? process.env.AZURE_SPEECH_KEY ?? "";
    this.region = options.region ?? process.env.AZURE_SPEECH_REGION ?? "";
    this.voice = options.voice ?? process.env.AZURE_TTS_VOICE ?? "fr-FR-Vivienne:DragonHDLatestNeural";
    this.temperature = options.temperature ?? parseFloat(process.env.AZURE_TTS_TEMPERATURE ?? "0.7");
    this.language = options.language ?? "fr-FR";
    this.gapMs = options.paragraphGapMs ?? 350;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  configKey(): string {
    return `azure:${this.region}:${this.voice}:${this.temperature}:${this.gapMs}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { "Ocp-Apim-Subscription-Key": this.key, "User-Agent": "avatar-studio", ...extra };
  }

  async check(): Promise<void> {
    if (!this.key || !this.region) {
      throw new Error("AZURE_SPEECH_KEY et AZURE_SPEECH_REGION doivent être définis dans .env pour la synthèse vocale.");
    }
    const url = `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/voices/list`;
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`Azure Speech : impossible de lister les voix dans la région « ${this.region} » (HTTP ${res.status}). Vérifiez la clé et la région.`);
    }
    const voices = (await res.json()) as { ShortName: string; Locale: string }[];
    const found = voices.some((v) => v.ShortName === this.voice);
    if (!found) {
      const hd = voices.filter((v) => v.ShortName.includes("DragonHD")).map((v) => v.ShortName);
      const fr = voices.filter((v) => v.Locale === "fr-FR").map((v) => v.ShortName);
      throw new Error(
        `La voix « ${this.voice} » n'existe pas dans la région Azure « ${this.region} ».\n` +
          `  Voix HD disponibles ici : ${hd.length ? hd.join(", ") : "aucune (les voix DragonHD ne sont proposées que dans certaines régions, ex. eastus, westeurope, southeastasia)"}\n` +
          `  Voix fr-FR disponibles : ${fr.slice(0, 12).join(", ")}${fr.length > 12 ? "…" : ""}`,
      );
    }
    log.done(`Azure Speech : voix ${this.voice} disponible dans ${this.region}`);
  }

  /** SSML minimal (les voix DragonHD n'acceptent qu'un sous-ensemble). */
  ssml(text: string): string {
    const isHd = this.voice.includes("DragonHD");
    const params = isHd ? ` parameters="temperature=${this.temperature}"` : "";
    return (
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${this.language}">` +
      `<voice name="${this.voice}"${params}>${escapeXml(text)}</voice></speak>`
    );
  }

  private async synthesizeBlock(text: string): Promise<Buffer> {
    const url = `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          method: "POST",
          headers: this.headers({ "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "raw-48khz-16bit-mono-pcm" }),
          body: this.ssml(text),
        });
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw Object.assign(new Error(`Azure TTS HTTP ${res.status} : ${body.slice(0, 300)}`), { fatal: true });
        }
        return Buffer.from(await res.arrayBuffer());
      } catch (e) {
        lastError = e as Error;
        if ((e as { fatal?: boolean }).fatal) throw e;
        const wait = 1000 * 2 ** (attempt - 1);
        log.warn(`Azure TTS : ${lastError.message}, nouvelle tentative dans ${wait / 1000} s (${attempt}/4)`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw new Error(`Azure TTS : échec après 4 tentatives (${lastError?.message})`);
  }

  /** Synthétise paragraphe par paragraphe et concatène avec un court silence. */
  async synthesize(text: string): Promise<TtsResult> {
    const blocks = text.split(/\n\s*\n/).map((b) => b.replace(/\s+/g, " ").trim()).filter(Boolean);
    const gap = Buffer.alloc(Math.round((SAMPLE_RATE * this.gapMs) / 1000) * 2);
    const parts: Buffer[] = [];
    for (let i = 0; i < blocks.length; i++) {
      log.info(`Azure TTS : bloc ${i + 1}/${blocks.length} (${blocks[i].length} caractères)`);
      parts.push(await this.synthesizeBlock(blocks[i]));
      if (i < blocks.length - 1) parts.push(gap);
    }
    return { pcm: Buffer.concat(parts), sampleRate: SAMPLE_RATE };
  }
}
