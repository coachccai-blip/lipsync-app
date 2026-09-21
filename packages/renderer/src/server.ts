import { createReadStream, existsSync, readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { PROJECT_FILES, configVocab, loadConfig, loadPerformance, repoRoot } from "@avatar/pipeline";

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
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export interface ServerOptions {
  projectDir: string;
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
  /** Charge la charge utile du projet (validation incluse). */
  payload(): unknown;
}

/** Construit la charge utile envoyée à window.loadProject(). */
export function buildPayload(projectDir: string, root: string, background: "green" | "transparent" = "green") {
  const config = loadConfig(root);
  const performance = loadPerformance(projectDir, configVocab(config));
  const modelPath = path.resolve(root, config.scene.model);
  const modelUrl = existsSync(modelPath) ? `/model/${encodeURIComponent(path.basename(modelPath))}` : undefined;
  const clipsDir = path.join(root, "assets", "clips");
  const clipUrls: Record<string, string> = {};
  if (existsSync(clipsDir)) {
    for (const f of readdirSync(clipsDir)) if (/\.(glb|gltf)$/i.test(f)) clipUrls[f] = `/clips/${encodeURIComponent(f)}`;
  }
  return { performance, config, modelUrl, modelPath, audioUrl: `/project/${performance.audio}`, clipUrls, background };
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

/**
 * Serveur HTTP local : page du player, fichiers du projet, modèle, clips, config,
 * /api/project (charge utile) et /events (SSE de rechargement à chaud).
 */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const root = options.root ?? repoRoot();
  const playerDist = options.playerDist ?? path.join(root, "packages", "player", "dist");
  if (!existsSync(path.join(playerDist, "index.html"))) {
    throw new Error(`Player non construit (${playerDist}) : lancez « npm run build » d'abord.`);
  }
  const projectDir = path.resolve(options.projectDir);
  const clients = new Set<http.ServerResponse>();
  const watchers: FSWatcher[] = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const p = decodeURIComponent(url.pathname);
    try {
      if (p === "/favicon.ico") {
        res.statusCode = 204;
        res.end();
      } else if (p === "/api/project") {
        const payload = buildPayload(projectDir, root, options.background);
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(payload));
      } else if (p === "/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        res.write("retry: 1000\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
      } else if (p.startsWith("/project/")) {
        send(res, safeJoin(projectDir, p.slice("/project/".length)));
      } else if (p.startsWith("/model/")) {
        const cfg = loadConfig(root);
        send(res, path.resolve(root, cfg.scene.model));
      } else if (p.startsWith("/clips/")) {
        send(res, safeJoin(path.join(root, "assets", "clips"), p.slice("/clips/".length)));
      } else if (p.startsWith("/config/")) {
        send(res, safeJoin(path.join(root, "config"), p.slice("/config/".length)));
      } else {
        send(res, safeJoin(playerDist, p === "/" ? "index.html" : p));
      }
    } catch (e) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end((e as Error).message);
    }
  });

  if (options.watch) {
    const notify = (what: string) => {
      for (const c of clients) c.write(`event: change\ndata: ${what}\n\n`);
    };
    let timer: NodeJS.Timeout | undefined;
    const debounced = (what: string) => {
      clearTimeout(timer);
      timer = setTimeout(() => notify(what), 150);
    };
    try {
      watchers.push(watch(projectDir, (_e, f) => f === PROJECT_FILES.performance && debounced("performance.json")));
      watchers.push(watch(path.join(root, "config"), (_e, f) => f && f.endsWith(".json") && debounced(`config/${f}`)));
    } catch {
      /* surveillance indisponible */
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
    payload: () => buildPayload(projectDir, root, options.background),
    close: async () => {
      for (const w of watchers) w.close();
      for (const c of clients) c.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function safeJoin(base: string, rel: string): string {
  const file = path.resolve(base, "." + path.posix.normalize("/" + rel));
  if (!file.startsWith(path.resolve(base))) return path.join(base, "__interdit__");
  return file;
}
