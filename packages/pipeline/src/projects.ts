import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PROJECT_FILES, readMeta, type ProjectMeta } from "./project.js";
import { loadPerformance } from "./project.js";

export interface ProjectSummary {
  name: string;
  dir: string;
  meta?: ProjectMeta;
  hasPerformance: boolean;
  duration?: number;
  text?: string;
  /** Erreur de validation de performance.json, le cas échéant. */
  error?: string;
  outputs: { name: string; size: number; mtime: string }[];
  sources: string[];
  updatedAt: string;
}

/** Nom de projet sûr (sous-dossier direct de projets/). */
export function safeProjectName(name: string): string {
  const clean = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  if (!clean) throw new Error("Nom de projet invalide");
  return clean.slice(0, 64);
}

export function summarizeProject(dir: string): ProjectSummary {
  const name = path.basename(dir);
  const perfFile = path.join(dir, PROJECT_FILES.performance);
  const summary: ProjectSummary = {
    name,
    dir,
    meta: readMeta(dir),
    hasPerformance: existsSync(perfFile),
    outputs: [],
    sources: [],
    updatedAt: statSync(dir).mtime.toISOString(),
  };
  if (summary.hasPerformance) {
    try {
      const perf = loadPerformance(dir);
      summary.duration = perf.duration;
      summary.text = perf.text.slice(0, 160);
      summary.updatedAt = statSync(perfFile).mtime.toISOString();
    } catch (e) {
      summary.error = (e as Error).message;
    }
  }
  for (const f of readdirSync(dir)) {
    if (/^(sortie.*\.(mp4|mov|webm)|planche.*\.png|image-.*\.png|.*\.srt)$/i.test(f)) {
      const st = statSync(path.join(dir, f));
      summary.outputs.push({ name: f, size: st.size, mtime: st.mtime.toISOString() });
    }
  }
  const src = path.join(dir, "source");
  if (existsSync(src)) summary.sources = readdirSync(src);
  return summary;
}

/** Liste les projets d'un dossier (projets/ par défaut), les plus récents d'abord. */
export function listProjects(projectsDir: string): ProjectSummary[] {
  if (!existsSync(projectsDir)) return [];
  return readdirSync(projectsDir)
    .filter((d) => !d.startsWith(".") && statSync(path.join(projectsDir, d)).isDirectory())
    .map((d) => summarizeProject(path.join(projectsDir, d)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
