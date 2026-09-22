import type { AllConfig, Performance } from "@avatar/shared";
import type { ProjectPayload } from "../api.js";

export interface ProjectSummary {
  name: string;
  dir: string;
  hasPerformance: boolean;
  duration?: number;
  text?: string;
  error?: string;
  outputs: { name: string; size: number; mtime: string }[];
  sources: string[];
  updatedAt: string;
  meta?: { mode: "audio" | "texte"; input: string };
}

export interface CheckItem {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  impact?: string;
}

export interface JobSummary {
  id: string;
  type: "prepare" | "render" | "planche" | "image";
  project: string;
  status: "en_attente" | "en_cours" | "termine" | "erreur" | "annule";
  createdAt: string;
  finishedAt?: string;
  result?: Record<string, unknown>;
  error?: string;
  progress?: { done: number; total: number };
}

export interface JobEvent {
  type: "log" | "progress" | "status";
  level?: string;
  message?: string;
  done?: number;
  total?: number;
  status?: JobSummary["status"];
  result?: Record<string, unknown>;
  at: string;
}

export type StudioPayload = ProjectPayload & { name: string; summary: ProjectSummary };

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* texte brut */
  }
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `${url} : HTTP ${res.status}`);
  return data as T;
}

/** Client de l'API du studio (serveur local `avatar studio`). */
export const api = {
  projects: () => req<{ projects: ProjectSummary[]; current?: string; projectsDir: string }>("/api/projects"),
  createProject: (name: string) => req<ProjectSummary>("/api/projects", { method: "POST", body: JSON.stringify({ name }) }),
  deleteProject: (name: string) => req<{ ok: true }>(`/api/projects/${encodeURIComponent(name)}`, { method: "DELETE" }),
  check: () => req<{ items: CheckItem[]; models: string[] }>("/api/check"),
  project: (name: string) => req<StudioPayload>(`/api/project?project=${encodeURIComponent(name)}`),
  upload: (project: string, file: File) =>
    req<{ name: string; size: number; kind: "audio" | "texte" }>(`/api/upload?project=${encodeURIComponent(project)}&name=${encodeURIComponent(file.name)}`, { method: "POST", body: file }),
  savePerformance: (project: string, perf: Performance) => req<{ ok: true }>(`/api/performance?project=${encodeURIComponent(project)}`, { method: "PUT", body: JSON.stringify(perf) }),
  transcript: (project: string) => req<{ transcript: string | null; script: string | null }>(`/api/transcript?project=${encodeURIComponent(project)}`),
  saveTranscript: (project: string, text: string) => req<{ ok: true }>(`/api/transcript?project=${encodeURIComponent(project)}`, { method: "PUT", body: text }),
  config: () => req<{ config: AllConfig; files: Record<string, unknown> }>("/api/config"),
  saveConfig: (name: keyof AllConfig, value: unknown) => req<{ ok: true; config: AllConfig }>(`/api/config/${name}`, { method: "PUT", body: JSON.stringify(value) }),
  jobs: () => req<{ jobs: JobSummary[] }>("/api/jobs"),
  startJob: (type: JobSummary["type"], project: string, options: Record<string, unknown>) => req<JobSummary>("/api/jobs", { method: "POST", body: JSON.stringify({ type, project, options }) }),
  cancelJob: (id: string) => req<{ ok: true }>(`/api/jobs/${id}/cancel`, { method: "POST" }),
  /** Suit un job : événements en direct, résolution à la fin. */
  followJob(id: string, onEvent: (e: JobEvent) => void): Promise<JobSummary["status"]> {
    return new Promise((resolve) => {
      const es = new EventSource(`/api/jobs/${id}/events`);
      let final: JobSummary["status"] | undefined;
      es.onmessage = (m) => {
        const ev = JSON.parse(m.data) as JobEvent;
        onEvent(ev);
        if (ev.type === "status" && ev.status && ev.status !== "en_attente" && ev.status !== "en_cours") {
          final = ev.status;
          es.close();
          resolve(final);
        }
      };
      es.onerror = () => {
        es.close();
        if (!final) req<JobSummary>(`/api/jobs/${id}`).then((j) => resolve(j.status)).catch(() => resolve("erreur"));
      };
    });
  },
};
