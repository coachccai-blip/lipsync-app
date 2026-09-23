import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { repoRoot, resolveTool, type ToolName } from "./tools.js";

export interface CheckItem {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  /** Ce qui ne marchera pas sans cet élément. */
  impact?: string;
}

export interface EnvironmentReport {
  items: CheckItem[];
  models: string[];
}

/** Bilan des outils externes, variables d'environnement et fichiers nécessaires. */
export function checkEnvironment(options: { root?: string; findChrome?: () => string | undefined } = {}): EnvironmentReport {
  const root = options.root ?? repoRoot();
  const items: CheckItem[] = [];
  const tools: { tool: ToolName; label: string; impact: string }[] = [
    { tool: "ffmpeg", label: "ffmpeg", impact: "normalisation audio et encodage vidéo" },
    { tool: "ffprobe", label: "ffprobe", impact: "durée des fichiers audio" },
    { tool: "rhubarb", label: "Rhubarb Lip Sync", impact: "lip sync (étape prepare)" },
    { tool: "whisper", label: "whisper.cpp", impact: "transcription et horodatage des mots (étape prepare)" },
  ];
  for (const t of tools) {
    try {
      items.push({ id: t.tool, label: t.label, ok: true, detail: resolveTool(t.tool), impact: t.impact });
    } catch (e) {
      items.push({ id: t.tool, label: t.label, ok: false, detail: (e as Error).message, impact: t.impact });
    }
  }
  const whisperModel = process.env.WHISPER_MODEL;
  items.push({ id: "whisper-model", label: "Modèle Whisper (WHISPER_MODEL)", ok: Boolean(whisperModel && existsSync(whisperModel)), detail: whisperModel ? (existsSync(whisperModel) ? whisperModel : `${whisperModel} introuvable`) : "non défini", impact: "transcription (étape prepare)" });
  const chrome = options.findChrome?.();
  items.push({ id: "chrome", label: "Chrome / Chromium", ok: Boolean(chrome), detail: chrome ?? "introuvable (CHROME_PATH ou npm run setup)", impact: "rendu vidéo et planche" });
  const envs: { id: string; label: string; secret: boolean; impact: string }[] = [
    { id: "AZURE_SPEECH_KEY", label: "Clé Azure Speech", secret: true, impact: "mode B (synthèse vocale)" },
    { id: "AZURE_SPEECH_REGION", label: "Région Azure Speech", secret: false, impact: "mode B (synthèse vocale)" },
    { id: "ANTHROPIC_API_KEY", label: "Clé Anthropic", secret: true, impact: "annotation automatique des expressions et gestes" },
    { id: "ANTHROPIC_MODEL", label: "Modèle Anthropic", secret: false, impact: "annotation (défaut : claude-opus-5)" },
  ];
  for (const e of envs) {
    const v = process.env[e.id];
    items.push({ id: e.id, label: e.label, ok: Boolean(v), detail: v ? (e.secret ? "défini" : v) : "non défini", impact: e.impact });
  }
  const cfg = loadConfig(root);
  const model = path.resolve(root, cfg.scene.model);
  items.push({ id: "model", label: "Modèle 3D (config/scene.json → model)", ok: existsSync(model), detail: existsSync(model) ? cfg.scene.model : `${cfg.scene.model} introuvable : personnage de substitution`, impact: "apparence du personnage" });
  const dist = path.join(root, "packages", "player", "dist", "index.html");
  items.push({ id: "player", label: "Player construit", ok: existsSync(dist), detail: existsSync(dist) ? "packages/player/dist" : "npm run build", impact: "studio et rendu" });
  const modelsDir = path.join(root, "assets", "models");
  const models = existsSync(modelsDir) ? readdirSync(modelsDir).filter((f) => /\.(glb|gltf)$/i.test(f)).map((f) => `assets/models/${f}`) : [];
  const puppetsDir = path.join(root, "assets");
  if (existsSync(puppetsDir)) {
    for (const d of readdirSync(puppetsDir)) {
      const manifest = path.join(puppetsDir, d, "marionnette.json");
      if (existsSync(manifest)) models.push(`assets/${d}/marionnette.json`);
    }
  }
  return { items, models };
}
