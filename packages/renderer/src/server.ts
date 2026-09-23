import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { findChrome } from "./chrome.js";
import {
  CONFIG_FILES,
  checkEnvironment,
  PROJECT_FILES,
  configVocab,
  listProjects,
  loadConfig,
  loadPerformance,
  log,
  prepare,
  repoRoot,
  safeProjectName,
  summarizeProject,
  type LogLevel,
} from "@avatar/pipeline";
import { mergeConfig, validatePerformance } from "@avatar/shared";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".srt": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export interface ServerOptions {
  /** Projet ouvert par défaut (avatar preview / render). */
  projectDir?: string;
  /** Dossier des projets (studio). Défaut : <racine>/projets. */
  projectsDir?: string;
  root?: string;
  /** Dossier dist du player (défaut : packages/player/dist sous la racine). */
  playerDist?: string;
  port?: number;
  /** Surveille performance.json et config/ et notifie /events. */
  watch?: boolean;
  background?: "green" | "transparent";
}

export interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
  /** Charge la charge utile du projet par défaut (validation incluse). */
  payload(): unknown;
}

export type JobType = "prepare" | "render" | "planche" | "image";
export type JobStatus = "en_attente" | "en_cours" | "termine" | "erreur" | "annule";

export interface JobEvent {
  type: "log" | "progress" | "status";
  level?: LogLevel;
  message?: string;
  done?: number;
  total?: number;
  status?: JobStatus;
  result?: unknown;
  at: string;
}

export interface Job {
  id: string;
  type: JobType;
  project: string;
  options: Record<string, unknown>;
  status: JobStatus;
  createdAt: string;
  finishedAt?: string;
  result?: unknown;
  error?: string;
  progress?: { done: number; total: number };
  events: JobEvent[];
}

/** Construit la charge utile envoyée à window.loadProject(). */
export function buildPayload(projectDir: string, root: string, background: "green" | "transparent" = "green") {
  const config = loadConfig(root);
  const performance = loadPerformance(projectDir, configVocab(config));
  const modelPath = path.resolve(root, config.scene.model);
  const modelUrl = existsSync(modelPath) ? `/model/${encodeURIComponent(path.basename(modelPath))}` : undefined;
  void modelUrl;
  const clipsDir = path.join(root, "assets", "clips");
  const clipUrls: Record<string, string> = {};
  if (existsSync(clipsDir)) {
    for (const f of readdirSync(clipsDir)) if (/\.(glb|gltf)$/i.test(f)) clipUrls[f] = `/clips/${encodeURIComponent(f)}`;
  }
  const name = path.basename(projectDir);
  return { name, performance, config, modelUrl, modelPath, audioUrl: `/files/${encodeURIComponent(name)}/${performance.audio}`, clipUrls, background };
}

function send(res: http.ServerResponse, file: string): void {
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.statusCode = 404;
    res.end("introuvable");
    return;
  }
  res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
  res.setHeader("Content-Length", statSync(file).size);
  res.setHeader("Cache-Control", "no-store");
  createReadStream(file).pipe(res);
}

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage, limit = 512 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("corps de requête trop volumineux"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function safeJoin(base: string, rel: string): string {
  const file = path.resolve(base, "." + path.posix.normalize("/" + rel));
  if (!file.startsWith(path.resolve(base))) return path.join(base, "__interdit__");
  return file;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Serveur HTTP local du studio : page du player, fichiers des projets, modèle, clips,
 * configuration (lecture et écriture), jobs (préparer, rendre, planche) avec journal en
 * direct, et /events (rechargement à chaud).
 */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const root = options.root ?? repoRoot();
  const playerDist = options.playerDist ?? path.join(root, "packages", "player", "dist");
  if (!existsSync(path.join(playerDist, "index.html"))) {
    throw new Error(`Player non construit (${playerDist}) : lancez « npm run build » d'abord.`);
  }
  const projectsDir = path.resolve(options.projectsDir ?? path.join(root, "projets"));
  const defaultProject = options.projectDir ? path.resolve(options.projectDir) : undefined;
  const background = options.background ?? "green";
  const clients = new Set<http.ServerResponse>();
  const watchers: FSWatcher[] = [];
  const jobs = new Map<string, Job>();
  const jobClients = new Map<string, Set<http.ServerResponse>>();
  const abortControllers = new Map<string, AbortController>();
  let queue: Promise<void> = Promise.resolve();
  /** Chemins écrits par le studio lui-même : leur prochain événement de modification est ignoré. */
  const selfWrites = new Map<string, number>();

  const projectDir = (name: string | null | undefined): string => {
    if (!name) {
      if (defaultProject) return defaultProject;
      throw new HttpError(400, "paramètre « project » manquant");
    }
    if (defaultProject && path.basename(defaultProject) === name) return defaultProject;
    const dir = path.join(projectsDir, safeProjectName(name));
    if (!existsSync(dir)) throw new HttpError(404, `projet « ${name} » introuvable`);
    return dir;
  };

  const notify = (what: string, project?: string) => {
    const data = JSON.stringify({ what, project });
    for (const c of clients) c.write(`event: change\ndata: ${data}\n\n`);
  };

  const pushJobEvent = (job: Job, ev: Omit<JobEvent, "at">) => {
    const full: JobEvent = { ...ev, at: new Date().toISOString() };
    job.events.push(full);
    if (job.events.length > 2000) job.events.splice(0, job.events.length - 1500);
    for (const c of jobClients.get(job.id) ?? []) c.write(`data: ${JSON.stringify(full)}\n\n`);
  };

  const setStatus = (job: Job, status: JobStatus, extra: { result?: unknown; error?: string } = {}) => {
    job.status = status;
    if (extra.result !== undefined) job.result = extra.result;
    if (extra.error) job.error = extra.error;
    if (status === "termine" || status === "erreur" || status === "annule") job.finishedAt = new Date().toISOString();
    pushJobEvent(job, { type: "status", status, result: job.result, message: job.error });
  };

  const runJob = async (job: Job): Promise<void> => {
    const controller = new AbortController();
    abortControllers.set(job.id, controller);
    const unlisten = log.listen((level, message) => pushJobEvent(job, { type: "log", level, message }));
    setStatus(job, "en_cours");
    try {
      if (controller.signal.aborted) throw new Error("annulé");
      const dir = projectDir(job.project);
      const o = job.options;
      if (job.type === "prepare") {
        const kind = String(o.kind ?? "audio");
        const source = path.join(dir, "source", path.basename(String(o.file ?? "")));
        if (!existsSync(source)) throw new Error(`fichier source introuvable : ${source}`);
        const r = await prepare({ [kind === "texte" ? "texte" : "audio"]: source, out: dir, sansLlm: Boolean(o.sansLlm), force: Boolean(o.force), rapide: Boolean(o.rapide), seed: typeof o.seed === "number" ? o.seed : undefined, root, signal: controller.signal });
        setStatus(job, "termine", { result: { warnings: r.warnings, duration: r.performance.duration } });
        notify("performance.json", job.project);
      } else if (job.type === "render") {
        const { renderProject } = await import("./render.js");
        const { FORMAT_EXT } = await import("./ffmpeg.js");
        const format = (o.format as "mp4" | "prores4444" | "webm-alpha") ?? "mp4";
        const draft = Boolean(o.brouillon);
        const outName = `sortie${draft ? "-brouillon" : ""}${FORMAT_EXT[format]}`;
        const r = await renderProject({
          projectDir: dir,
          format,
          out: path.join(dir, outName),
          debut: typeof o.debut === "number" ? o.debut : undefined,
          fin: typeof o.fin === "number" ? o.fin : undefined,
          scale: draft ? 2 : 1,
          srt: Boolean(o.srt),
          root,
          quiet: true,
          signal: controller.signal,
          onProgress: (done, total) => {
            job.progress = { done, total };
            if (done % 3 === 0 || done === total) pushJobEvent(job, { type: "progress", done, total });
          },
        });
        setStatus(job, "termine", { result: { output: outName, url: `/files/${encodeURIComponent(job.project)}/${outName}`, frames: r.frames, duration: r.duration, srt: o.srt ? outName.replace(/\.[^.]+$/, ".srt") : undefined } });
      } else if (job.type === "image") {
        const { renderProject } = await import("./render.js");
        const perf = loadPerformance(dir);
        const fps = perf.fps;
        const lastIndex = Math.max(0, Math.ceil(perf.duration * fps) - 1);
        const frame = Math.min(lastIndex, Math.max(0, Math.round((typeof o.t === "number" ? o.t : 0) * fps)));
        const framesDir = path.join(dir, "cache", "image");
        rmSync(framesDir, { recursive: true, force: true });
        // fin = (frame + 0,5) / fps : la boucle de rendu (ceil) s'arrête exactement après cette image
        await renderProject({ projectDir: dir, format: Boolean(o.transparent) ? "webm-alpha" : "mp4", debut: frame / fps, fin: (frame + 0.5) / fps, skipEncode: true, framesDir, root, quiet: true, signal: controller.signal });
        const produced = readdirSync(framesDir).filter((f) => f.endsWith(".png")).sort()[0];
        if (!produced) throw new Error("aucune image produite");
        const t = frame / fps;
        const name = `image-${t.toFixed(2).replace(".", "_")}s.png`;
        writeFileSync(path.join(dir, name), readFileSync(path.join(framesDir, produced)));
        setStatus(job, "termine", { result: { output: name, url: `/files/${encodeURIComponent(job.project)}/${name}?ts=${Date.now()}` } });
      } else if (job.type === "planche") {
        const { renderPoseSheet } = await import("./sheet.js");
        const out = path.join(dir, "planche.png");
        await renderPoseSheet({ projectDir: dir, out, emotions: Boolean(o.emotions), root, bones: o.bones as never, signal: controller.signal });
        setStatus(job, "termine", { result: { output: "planche.png", url: `/files/${encodeURIComponent(job.project)}/planche.png?ts=${Date.now()}` } });
      }
    } catch (e) {
      setStatus(job, controller.signal.aborted ? "annule" : "erreur", { error: (e as Error).message });
    } finally {
      unlisten();
      abortControllers.delete(job.id);
      for (const c of jobClients.get(job.id) ?? []) c.end();
      jobClients.delete(job.id);
    }
  };

  const enqueue = (job: Job) => {
    jobs.set(job.id, job);
    queue = queue.then(() => (job.status === "annule" ? undefined : runJob(job))).catch(() => undefined);
  };

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const p = decodeURIComponent(url.pathname);
    const project = url.searchParams.get("project");

    if (p === "/favicon.ico") {
      res.statusCode = 204;
      return void res.end();
    }

    // ---- projets ----
    if (p === "/api/projects" && req.method === "GET") {
      const list = listProjects(projectsDir);
      if (defaultProject && !list.some((s) => s.dir === defaultProject) && existsSync(defaultProject)) list.unshift(summarizeProject(defaultProject));
      return json(res, { projects: list, current: defaultProject ? path.basename(defaultProject) : list[0]?.name, projectsDir });
    }
    if (p === "/api/projects" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString() || "{}") as { name?: string };
      const name = safeProjectName(String(body.name ?? ""));
      const dir = path.join(projectsDir, name);
      mkdirSync(path.join(dir, "source"), { recursive: true });
      return json(res, summarizeProject(dir), 201);
    }
    const deleteMatch = /^\/api\/projects\/([^/]+)$/.exec(p);
    if (deleteMatch && req.method === "DELETE") {
      const dir = projectDir(deleteMatch[1]);
      if (!dir.startsWith(projectsDir + path.sep)) throw new HttpError(400, "ce projet n'est pas dans le dossier des projets");
      rmSync(dir, { recursive: true, force: true });
      return json(res, { ok: true });
    }
    if (p === "/api/check") {
      return json(res, checkEnvironment({ root, findChrome }));
    }
    if (p === "/api/project") {
      const dir = projectDir(project);
      return json(res, { ...buildPayload(dir, root, background), summary: summarizeProject(dir) });
    }
    if (p === "/api/upload" && req.method === "POST") {
      const dir = projectDir(project);
      const name = path.basename(url.searchParams.get("name") ?? "fichier");
      if (!/\.(mp3|wav|m4a|ogg|flac|aac|txt|md)$/i.test(name)) throw new HttpError(400, "type de fichier non pris en charge (audio ou texte)");
      const body = await readBody(req);
      mkdirSync(path.join(dir, "source"), { recursive: true });
      writeFileSync(path.join(dir, "source", name), body);
      return json(res, { name, size: body.length, kind: /\.(txt|md)$/i.test(name) ? "texte" : "audio" }, 201);
    }
    if (p === "/api/performance" && req.method === "PUT") {
      const dir = projectDir(project);
      const raw = JSON.parse((await readBody(req)).toString());
      const vocab = configVocab(loadConfig(root));
      const perf = validatePerformance(raw, { knownEmotions: vocab.emotions, knownGestures: vocab.gestures });
      const file = path.join(dir, PROJECT_FILES.performance);
      selfWrites.set(file, Date.now());
      writeFileSync(file, JSON.stringify(perf, null, 2));
      return json(res, { ok: true });
    }
    if (p === "/api/transcript" && req.method === "PUT") {
      const dir = projectDir(project);
      writeFileSync(path.join(dir, PROJECT_FILES.transcript), (await readBody(req)).toString());
      return json(res, { ok: true });
    }
    if (p === "/api/transcript" && req.method === "GET") {
      const dir = projectDir(project);
      const f = path.join(dir, PROJECT_FILES.transcript);
      const s = path.join(dir, PROJECT_FILES.script);
      return json(res, { transcript: existsSync(f) ? readFileSync(f, "utf8") : null, script: existsSync(s) ? readFileSync(s, "utf8") : null });
    }

    // ---- configuration ----
    if (p === "/api/config" && req.method === "GET") {
      const files: Record<string, unknown> = {};
      for (const name of CONFIG_FILES) {
        const f = path.join(root, "config", `${name}.json`);
        if (existsSync(f)) files[name] = JSON.parse(readFileSync(f, "utf8"));
      }
      return json(res, { config: loadConfig(root), files });
    }
    const configMatch = /^\/api\/config\/([a-z]+)$/.exec(p);
    if (configMatch && req.method === "PUT") {
      const name = configMatch[1] as (typeof CONFIG_FILES)[number];
      if (!CONFIG_FILES.includes(name)) throw new HttpError(404, `config inconnue : ${name}`);
      const raw = JSON.parse((await readBody(req)).toString());
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new HttpError(400, "objet JSON attendu");
      mergeConfig({ [name]: raw }); // lève si la fusion est impossible
      const file = path.join(root, "config", `${name}.json`);
      const previous = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
      const doc = previous._doc ? { _doc: previous._doc } : {};
      selfWrites.set(file, Date.now());
      writeFileSync(file, JSON.stringify({ ...doc, ...(raw as object) }, null, 2) + "\n");
      return json(res, { ok: true, config: loadConfig(root) });
    }

    // ---- jobs ----
    if (p === "/api/jobs" && req.method === "GET") {
      return json(res, { jobs: [...jobs.values()].map(({ events, ...j }) => ({ ...j, eventCount: events.length })).reverse() });
    }
    if (p === "/api/jobs" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString() || "{}") as { type?: JobType; project?: string; options?: Record<string, unknown> };
      if (!body.type || !["prepare", "render", "planche", "image"].includes(body.type)) throw new HttpError(400, "type de job invalide");
      const name = body.project ?? (defaultProject ? path.basename(defaultProject) : undefined);
      if (!name) throw new HttpError(400, "projet manquant");
      projectDir(name);
      const job: Job = { id: randomUUID().slice(0, 8), type: body.type, project: name, options: body.options ?? {}, status: "en_attente", createdAt: new Date().toISOString(), events: [] };
      enqueue(job);
      const { events, ...summary } = job;
      void events;
      return json(res, summary, 201);
    }
    const jobMatch = /^\/api\/jobs\/([a-z0-9-]+)(\/events|\/cancel)?$/.exec(p);
    if (jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) throw new HttpError(404, "job introuvable");
      if (jobMatch[2] === "/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        for (const ev of job.events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
        if (job.finishedAt) return void res.end();
        let set = jobClients.get(job.id);
        if (!set) jobClients.set(job.id, (set = new Set()));
        set.add(res);
        req.on("close", () => set!.delete(res));
        return;
      }
      if (jobMatch[2] === "/cancel" && req.method === "POST") {
        if (job.status === "en_attente") setStatus(job, "annule");
        abortControllers.get(job.id)?.abort();
        return json(res, { ok: true });
      }
      const { events, ...summary } = job;
      return json(res, { ...summary, events: events.slice(-200) });
    }

    // ---- flux de rechargement ----
    if (p === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write("retry: 1000\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    // ---- fichiers ----
    if (p.startsWith("/files/")) {
      const [name, ...rest] = p.slice("/files/".length).split("/");
      return send(res, safeJoin(projectDir(name), rest.join("/")));
    }
    if (p.startsWith("/project/")) return send(res, safeJoin(projectDir(project), p.slice("/project/".length)));
    if (p.startsWith("/model/")) {
      // GLB : le fichier lui-même ; marionnette (manifeste .json) : les fichiers de son dossier
      const modelPath = path.resolve(root, loadConfig(root).scene.model);
      if (modelPath.endsWith(".json")) return send(res, safeJoin(path.dirname(modelPath), p.slice("/model/".length)));
      return send(res, modelPath);
    }
    if (p.startsWith("/clips/")) return send(res, safeJoin(path.join(root, "assets", "clips"), p.slice("/clips/".length)));
    if (p.startsWith("/config/")) return send(res, safeJoin(path.join(root, "config"), p.slice("/config/".length)));
    return send(res, safeJoin(playerDist, p === "/" ? "index.html" : p));
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (!res.headersSent) json(res, { error: (e as Error).message }, status);
      else res.end();
    });
  });

  if (options.watch) {
    let timer: NodeJS.Timeout | undefined;
    const pending = new Set<string>();
    const debounced = (what: string, project?: string) => {
      pending.add(JSON.stringify({ what, project }));
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const k of pending) {
          const { what: w, project: pr } = JSON.parse(k) as { what: string; project?: string };
          notify(w, pr);
        }
        pending.clear();
      }, 200);
    };
    const isSelfWrite = (file: string) => {
      const at = selfWrites.get(file);
      if (at && Date.now() - at < 3000) return true;
      selfWrites.delete(file);
      return false;
    };
    try {
      if (existsSync(projectsDir)) {
        watchers.push(
          watch(projectsDir, { recursive: true }, (_e, f) => {
            if (!f) return;
            const parts = String(f).split(path.sep);
            if (parts.length === 2 && parts[1] === PROJECT_FILES.performance && !isSelfWrite(path.join(projectsDir, String(f)))) debounced("performance.json", parts[0]);
          }),
        );
      }
      if (defaultProject && !defaultProject.startsWith(projectsDir)) {
        watchers.push(watch(defaultProject, (_e, f) => f === PROJECT_FILES.performance && !isSelfWrite(path.join(defaultProject, f)) && debounced("performance.json", path.basename(defaultProject))));
      }
      watchers.push(watch(path.join(root, "config"), (_e, f) => f && f.endsWith(".json") && !isSelfWrite(path.join(root, "config", f)) && debounced(`config/${f}`)));
    } catch {
      /* surveillance indisponible sur cette plateforme */
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    payload: () => buildPayload(projectDir(undefined), root, background),
    close: async () => {
      for (const w of watchers) w.close();
      for (const c of clients) c.end();
      for (const set of jobClients.values()) for (const c of set) c.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
