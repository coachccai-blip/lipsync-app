import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { log } from "./log.js";
import { repoRoot, resolveTool, run } from "./tools.js";
import { encodePng } from "./png.js";

/**
 * Génération automatique d'une marionnette 2D (26 images) à partir d'une photo, via l'API
 * d'édition d'images d'OpenAI (gpt-image-1) avec masques : tout ce qui est hors du masque est
 * conservé au pixel près, ce qui garantit l'alignement des calques.
 */

export type ZoneKey = "bouche" | "yeux" | "sourcils_yeux" | "mains";

export interface Zones {
  /** Rectangles en fractions de l'image (0..1). */
  bouche: Rect;
  yeux: Rect;
  sourcilsYeux: Rect;
  /** Ellipse du visage (exclue du masque des mains), en fractions. */
  visage: { cx: number; cy: number; rx: number; ry: number };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const DEFAULT_ZONES: Zones = {
  bouche: { x: 0.33, y: 0.5, w: 0.34, h: 0.2 },
  yeux: { x: 0.25, y: 0.33, w: 0.5, h: 0.15 },
  sourcilsYeux: { x: 0.23, y: 0.25, w: 0.54, h: 0.25 },
  visage: { cx: 0.5, cy: 0.42, rx: 0.28, ry: 0.36 },
};

export interface ImageSpec {
  /** Suffixe du fichier (après le préfixe <nom>_). */
  file: string;
  zone: ZoneKey | "base";
  /** Rôle dans le manifeste. */
  role: { group: "mouths" | "eyes" | "emotions" | "gaze" | "mouthsSmile" | "hands"; key: string } | { group: "base" };
  prompt: string;
}

const KEEP = " Ne modifie rien d'autre : même personnage, même cadrage, même lumière, même style, même fond.";

export const IMAGE_SPECS: ImageSpec[] = [
  { file: "base", zone: "base", role: { group: "base" }, prompt: "Bouche fermée, détendue et neutre : lèvres jointes, pas de sourire, pas de dents visibles, coins de la bouche au repos. Expression calme." + KEEP },
  { file: "bouche_A", zone: "bouche", role: { group: "mouths", key: "A" }, prompt: "Lèvres fermées et légèrement pressées l'une contre l'autre, comme au début du son « M » ou « P », un peu plus fermes qu'au repos." + KEEP },
  { file: "bouche_B", zone: "bouche", role: { group: "mouths", key: "B" }, prompt: "Lèvres légèrement entrouvertes laissant voir les dents du haut et du bas serrées l'une contre l'autre, ouverture très faible, pas de langue." + KEEP },
  { file: "bouche_C", zone: "bouche", role: { group: "mouths", key: "C" }, prompt: "Bouche ouverte à moitié, forme légèrement ovale, dents du haut visibles, mâchoire un peu abaissée." + KEEP },
  { file: "bouche_D", zone: "bouche", role: { group: "mouths", key: "D" }, prompt: "Bouche grande ouverte, mâchoire nettement abaissée, forme ovale verticale, dents du haut visibles, intérieur de la bouche visible." + KEEP },
  { file: "bouche_E", zone: "bouche", role: { group: "mouths", key: "E" }, prompt: "Lèvres arrondies formant un « O » ouvert de taille moyenne, intérieur sombre visible." + KEEP },
  { file: "bouche_F", zone: "bouche", role: { group: "mouths", key: "F" }, prompt: "Lèvres pincées et projetées vers l'avant en un petit cercle serré, comme pour le son « OU »." + KEEP },
  { file: "bouche_G", zone: "bouche", role: { group: "mouths", key: "G" }, prompt: "Lèvre inférieure repliée vers l'intérieur, touchant les dents du haut qui sont visibles, lèvre supérieure normale, ouverture faible (son « F » ou « V »)." + KEEP },
  { file: "bouche_H", zone: "bouche", role: { group: "mouths", key: "H" }, prompt: "Bouche ouverte moyennement, pointe de la langue relevée et visible touchant l'arrière des dents du haut (son « L »)." + KEEP },
  { file: "yeux_fermes", zone: "yeux", role: { group: "eyes", key: "closed" }, prompt: "Les deux paupières complètement fermées, chaque œil devient une ligne courbe douce (cils conservés), comme au milieu d'un clignement. Sourcils inchangés." + KEEP },
  { file: "yeux_mi_clos", zone: "yeux", role: { group: "eyes", key: "half" }, prompt: "Paupières à moitié fermées : la moitié supérieure des yeux est couverte, le blanc de l'œil et la pupille restent visibles dessous, regard droit. Sourcils inchangés." + KEEP },
  { file: "emotion_enjoue", zone: "sourcils_yeux", role: { group: "emotions", key: "enjoué" }, prompt: "Sourcils légèrement relevés et détendus, yeux un peu plissés par un sourire (paupières inférieures remontées), expression joyeuse et chaleureuse." + KEEP },
  { file: "emotion_surpris", zone: "sourcils_yeux", role: { group: "emotions", key: "surpris" }, prompt: "Sourcils nettement relevés, yeux plus grands et bien ouverts, expression de surprise." + KEEP },
  { file: "emotion_serieux", zone: "sourcils_yeux", role: { group: "emotions", key: "sérieux" }, prompt: "Sourcils abaissés et légèrement froncés vers le centre, regard concentré et déterminé, sans colère." + KEEP },
  { file: "emotion_pensif", zone: "sourcils_yeux", role: { group: "emotions", key: "pensif" }, prompt: "Un sourcil légèrement relevé, l'autre au repos, regard tourné vers le haut et le côté comme quelqu'un qui réfléchit." + KEEP },
  { file: "regard_gauche", zone: "yeux", role: { group: "gaze", key: "left" }, prompt: "Les iris et les pupilles des deux yeux sont déplacés vers la gauche de l'image (le personnage regarde vers sa droite, hors caméra). Paupières et sourcils inchangés." + KEEP },
  { file: "regard_droite", zone: "yeux", role: { group: "gaze", key: "right" }, prompt: "Les iris et les pupilles des deux yeux sont déplacés vers la droite de l'image (le personnage regarde vers sa gauche, hors caméra). Paupières et sourcils inchangés." + KEEP },
  { file: "regard_haut", zone: "yeux", role: { group: "gaze", key: "up" }, prompt: "Les iris et les pupilles des deux yeux sont déplacés vers le haut, comme quelqu'un qui cherche ses mots. Paupières ouvertes et sourcils inchangés." + KEEP },
  { file: "bouche_X_sourire", zone: "bouche", role: { group: "mouthsSmile", key: "X" }, prompt: "Bouche fermée avec un vrai sourire, coins des lèvres nettement relevés, pommettes légèrement remontées." + KEEP },
  { file: "bouche_B_sourire", zone: "bouche", role: { group: "mouthsSmile", key: "B" }, prompt: "Grand sourire ouvert montrant les dents du haut serrées contre celles du bas, coins des lèvres relevés vers les pommettes." + KEEP },
  { file: "bouche_D_sourire", zone: "bouche", role: { group: "mouthsSmile", key: "D" }, prompt: "Bouche grande ouverte comme sur un « A » rieur : mâchoire abaissée, coins des lèvres relevés, dents du haut visibles, intérieur visible." + KEEP },
  { file: "main_levee", zone: "mains", role: { group: "hands", key: "salut" }, prompt: "Le personnage lève sa main droite (à gauche de l'image) à hauteur de l'épaule, paume ouverte tournée vers la caméra, comme pour dire bonjour. Main et avant-bras entièrement dans le cadre, sans toucher le visage ni le cou." + KEEP },
  { file: "mains_ouvertes", zone: "mains", role: { group: "hands", key: "explication" }, prompt: "Les deux mains apparaissent en bas de l'image à hauteur de la poitrine, paumes ouvertes tournées vers le haut, coudes bas, comme quelqu'un qui explique calmement. Mains entièrement dans le cadre, sous le menton." + KEEP },
  { file: "main_index", zone: "mains", role: { group: "hands", key: "index" }, prompt: "Le personnage lève sa main droite (à gauche de l'image) à hauteur de l'épaule, index tendu vers le haut, autres doigts repliés. Main entièrement dans le cadre, sans toucher le visage." + KEEP },
  { file: "main_pouce", zone: "mains", role: { group: "hands", key: "approbation" }, prompt: "Le personnage montre un pouce levé de la main droite (à gauche de l'image), main à hauteur de l'épaule, tournée vers la caméra. Main entièrement dans le cadre, sans toucher le visage." + KEEP },
];

/** Masque PNG RGBA : alpha 0 (transparent) = zone à redessiner, alpha 255 = conservé. */
export function buildMask(zone: ZoneKey, zones: Zones, size: number, feather = 0): Buffer {
  const rgba = new Uint8Array(size * size * 4);
  const inRect = (r: Rect, x: number, y: number) => x >= r.x * size && x < (r.x + r.w) * size && y >= r.y * size && y < (r.y + r.h) * size;
  const f = zones.visage;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let edit = false;
      if (zone === "bouche") edit = inRect(zones.bouche, x, y);
      else if (zone === "yeux") edit = inRect(zones.yeux, x, y);
      else if (zone === "sourcils_yeux") edit = inRect(zones.sourcilsYeux, x, y);
      else {
        // mains : tout sauf le visage (ellipse) et le haut de l'image au-dessus des épaules
        const dx = (x / size - f.cx) / f.rx;
        const dy = (y / size - f.cy) / f.ry;
        const inFace = dx * dx + dy * dy < 1;
        const below = y / size > f.cy;
        const side = x / size < f.cx - f.rx || x / size > f.cx + f.rx;
        edit = !inFace && (below || side);
      }
      const i = (y * size + x) * 4;
      rgba[i] = 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = edit ? 0 : 255;
    }
  }
  void feather;
  return encodePng(size, size, rgba);
}

export interface EditOptions {
  apiKey: string;
  image: Buffer;
  mask: Buffer;
  prompt: string;
  size: number;
  quality: "low" | "medium" | "high";
  model?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/** Un appel à l'API d'édition d'images (multipart), avec reprises sur 429 / 5xx. */
export async function openaiEdit(o: EditOptions): Promise<Buffer> {
  const fetchFn = o.fetchImpl ?? fetch;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (o.signal?.aborted) throw new Error("annulé");
    const form = new FormData();
    form.append("model", o.model ?? "gpt-image-1");
    form.append("prompt", o.prompt);
    form.append("size", `${o.size}x${o.size}`);
    form.append("quality", o.quality);
    form.append("n", "1");
    form.append("image", new Blob([new Uint8Array(o.image)], { type: "image/png" }), "image.png");
    form.append("mask", new Blob([new Uint8Array(o.mask)], { type: "image/png" }), "mask.png");
    const res = await fetchFn("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${o.apiKey}` }, body: form, signal: o.signal });
    if (res.ok) {
      const json = (await res.json()) as { data?: { b64_json?: string }[] };
      const b64 = json.data?.[0]?.b64_json;
      if (!b64) throw new Error("réponse OpenAI sans image");
      return Buffer.from(b64, "base64");
    }
    const text = await res.text().catch(() => "");
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
    } catch {
      /* texte brut */
    }
    lastError = new Error(`OpenAI ${res.status} : ${message.slice(0, 300)}`);
    if (res.status === 429 || res.status >= 500) {
      const wait = 2000 * attempt;
      log.warn(`${lastError.message} ; nouvelle tentative dans ${wait / 1000} s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw lastError;
  }
  throw lastError ?? new Error("OpenAI : échec");
}

export interface PersonnageOptions {
  /** Photo d'origine (png, jpg, webp…). */
  photo: string;
  /** Nom du personnage = dossier assets/<nom>/ et préfixe des fichiers. */
  nom: string;
  root?: string;
  apiKey?: string;
  /** Côté des images générées (1024 par défaut : seule taille carrée de gpt-image-1). */
  size?: number;
  quality?: "low" | "medium" | "high";
  zones?: Partial<Zones>;
  sansMains?: boolean;
  /** Ne (re)générer que ces images (suffixes, ex. ["bouche_D", "emotion_enjoue"]). */
  seulement?: string[];
  /** Regénérer même si le fichier existe. */
  force?: boolean;
  signal?: AbortSignal;
  onProgress?(done: number, total: number, file: string): void;
  fetchImpl?: typeof fetch;
}

export interface PersonnageResult {
  dir: string;
  manifest: string;
  model: string;
  files: string[];
  planche?: string;
  skipped: string[];
}

export function safePersonnageName(nom: string): string {
  const s = nom.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!s || s === "models" || s === "clips") throw new Error(`nom de personnage invalide : ${nom}`);
  return s;
}

/** Recadre la photo en carré size×size (PNG) avec ffmpeg. */
export async function prepareSource(photo: string, out: string, size: number): Promise<void> {
  const ffmpeg = resolveTool("ffmpeg");
  await run(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", photo, "-vf", `scale=${size}:${size}:force_original_aspect_ratio=increase:flags=lanczos,crop=${size}:${size}`, "-frames:v", "1", out]);
}

export function buildManifest(nom: string, files: string[]): Record<string, unknown> {
  const has = (f: string) => files.includes(`${nom}_${f}.png`);
  const m: Record<string, unknown> = {
    _doc: `Marionnette 2D « ${nom} » générée par « avatar personnage » (API OpenAI, masques par zone). Zones bouche / yeux détectées automatiquement par différence avec la base.`,
    version: Date.now(),
    base: `${nom}_base.png`,
    mouths: { X: `${nom}_base.png` },
  };
  const groups: Record<string, Record<string, string>> = { mouths: m.mouths as Record<string, string>, eyes: {}, emotions: {}, gaze: {}, mouthsSmile: {}, hands: {} };
  for (const s of IMAGE_SPECS) {
    if (s.role.group === "base" || !has(s.file)) continue;
    groups[s.role.group][s.role.key] = `${nom}_${s.file}.png`;
  }
  for (const [g, v] of Object.entries(groups)) if (Object.keys(v).length) m[g] = v;
  if (groups.mouthsSmile && Object.keys(groups.mouthsSmile).length) m.smileEmotions = ["enjoué"];
  m.keyColor = "auto";
  m.keyTolerance = 0.12;
  m.regions = null;
  return m;
}

/** Planche de contrôle (toutes les images réduites, 7 par ligne) avec ffmpeg. */
export async function buildPlanche(files: string[], out: string, tile = 256): Promise<void> {
  if (!files.length) return;
  const ffmpeg = resolveTool("ffmpeg");
  const cols = Math.min(7, files.length);
  const rows = Math.ceil(files.length / cols);
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const f of files) args.push("-i", f);
  const inputs = files.map((_, i) => `[${i}:v]scale=${tile}:${tile}[s${i}]`).join(";");
  const concat = files.map((_, i) => `[s${i}]`).join("") + `concat=n=${files.length}:v=1:a=0,tile=${cols}x${rows}:padding=4:margin=4:color=white[out]`;
  args.push("-filter_complex", `${inputs};${concat}`, "-map", "[out]", "-frames:v", "1", out);
  await run(ffmpeg, args);
}

/** Génère (ou complète) une marionnette 2D dans assets/<nom>/. */
export async function generatePersonnage(o: PersonnageOptions): Promise<PersonnageResult> {
  const root = o.root ?? repoRoot();
  const apiKey = o.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY manquante : définissez-la dans .env (clé API OpenAI avec facturation activée).");
  const nom = safePersonnageName(o.nom);
  const size = o.size ?? 1024;
  const quality = o.quality ?? "high";
  const zones: Zones = { ...DEFAULT_ZONES, ...(o.zones ?? {}) };
  const dir = path.join(root, "assets", nom);
  mkdirSync(dir, { recursive: true });
  const wanted = new Set((o.seulement ?? []).map((s) => s.replace(/\.png$/i, "").replace(new RegExp(`^${nom}_`), "")));
  const specs = IMAGE_SPECS.filter((s) => (!o.sansMains || s.zone !== "mains") && (wanted.size === 0 || wanted.has(s.file) || (s.file === "base" && !existsSync(path.join(dir, `${nom}_base.png`)))));
  const total = specs.length;
  let done = 0;
  const skipped: string[] = [];

  // 1. photo source recadrée
  const source = path.join(dir, `${nom}_source.png`);
  if (!existsSync(source) || o.force || wanted.size === 0) {
    log.step(`Photo source → ${path.relative(root, source)} (${size}×${size})`);
    await prepareSource(o.photo, source, size);
  }

  // 2. base, puis variantes (chacune éditée à partir de la base, avec le masque de sa zone)
  const basePath = path.join(dir, `${nom}_base.png`);
  for (const spec of specs) {
    if (o.signal?.aborted) throw new Error("annulé");
    const outPath = path.join(dir, `${nom}_${spec.file}.png`);
    if (existsSync(outPath) && !o.force && !wanted.has(spec.file)) {
      skipped.push(spec.file);
      done++;
      o.onProgress?.(done, total, spec.file);
      continue;
    }
    const isBase = spec.zone === "base";
    const image = readFileSync(isBase ? source : basePath);
    const mask = buildMask(isBase ? "bouche" : (spec.zone as ZoneKey), zones, size);
    log.step(`${spec.file} (${isBase ? "bouche, depuis la photo" : spec.zone})`);
    const png = await openaiEdit({ apiKey, image, mask, prompt: spec.prompt, size, quality, signal: o.signal, fetchImpl: o.fetchImpl });
    writeFileSync(outPath, png);
    done++;
    o.onProgress?.(done, total, spec.file);
  }
  if (!existsSync(basePath)) throw new Error("base non générée");
  copyFileSync(basePath, path.join(dir, `${nom}_bouche_X.png`));

  // 3. manifeste + planche
  const names = [`${nom}_base.png`, `${nom}_bouche_X.png`, ...IMAGE_SPECS.filter((s) => s.zone !== "base").map((s) => `${nom}_${s.file}.png`)];
  const files = names.filter((f) => existsSync(path.join(dir, f)));
  const manifest = buildManifest(nom, files);
  const manifestPath = path.join(dir, "marionnette.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  const planche = path.join(dir, `${nom}_planche.png`);
  try {
    await buildPlanche(files.map((f) => path.join(dir, f)), planche);
  } catch (e) {
    log.warn(`planche non produite : ${(e as Error).message}`);
  }
  log.done(`${files.length} images dans ${path.relative(root, dir)} ; manifeste écrit`);
  return { dir, manifest: manifestPath, model: `assets/${nom}/marionnette.json`, files, planche: existsSync(planche) ? planche : undefined, skipped };
}
