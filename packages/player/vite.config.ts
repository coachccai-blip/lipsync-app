import { defineConfig, type Plugin } from "vite";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const sharedSrc = path.resolve(here, "../shared/src/index.ts");

/**
 * Sert config/ et assets/ du dépôt en développement, et les copie dans dist/ au build
 * (mode démo / GitHub Pages : la page lit ./config/*.json et ./assets/models/*.glb).
 */
function repoFiles(): Plugin {
  const serveDir = (prefix: string, dir: string) => (req: { url?: string }, res: { setHeader: (k: string, v: string) => void; end: (b?: Buffer) => void; statusCode: number }, next: () => void) => {
    if (!req.url?.startsWith(prefix)) return next();
    const rel = decodeURIComponent(req.url.slice(prefix.length).split("?")[0]);
    const file = path.join(dir, rel);
    if (!file.startsWith(dir) || !existsSync(file) || rel === "") return next();
    import("node:fs").then((fs) => {
      res.setHeader("Content-Type", file.endsWith(".json") ? "application/json" : file.endsWith(".glb") ? "model/gltf-binary" : "application/octet-stream");
      res.end(fs.readFileSync(file));
    });
  };
  return {
    name: "avatar-repo-files",
    configureServer(server) {
      server.middlewares.use(serveDir("/config/", path.join(repoRoot, "config")));
      server.middlewares.use(serveDir("/assets/", path.join(repoRoot, "assets")));
    },
    closeBundle() {
      const out = path.join(here, "dist");
      const copyDir = (from: string, to: string, filter: (f: string) => boolean) => {
        if (!existsSync(from)) return;
        mkdirSync(to, { recursive: true });
        for (const f of readdirSync(from)) if (filter(f)) copyFileSync(path.join(from, f), path.join(to, f));
      };
      copyDir(path.join(repoRoot, "config"), path.join(out, "config"), (f) => f.endsWith(".json"));
      copyDir(path.join(repoRoot, "assets", "models"), path.join(out, "assets", "models"), (f) => /\.(glb|gltf|bin|png|jpg|jpeg|webp)$/i.test(f));
      copyDir(path.join(repoRoot, "assets", "clips"), path.join(out, "assets", "clips"), (f) => /\.(glb|gltf|bin)$/i.test(f));
      // toutes les marionnettes : chaque dossier assets/<nom>/ contenant un marionnette.json
      const assetsDir = path.join(repoRoot, "assets");
      if (existsSync(assetsDir)) {
        for (const d of readdirSync(assetsDir)) {
          if (!existsSync(path.join(assetsDir, d, "marionnette.json"))) continue;
          copyDir(path.join(assetsDir, d), path.join(out, "assets", d), (f) => /\.(png|jpg|jpeg|webp|json)$/i.test(f));
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: mode === "pages" ? process.env.BASE_PATH ?? "/lipsync-app/" : "./",
  publicDir: false,
  plugins: [repoFiles()],
  resolve: { alias: { "@avatar/shared": sharedSrc } },
  build: { outDir: "dist", emptyOutDir: true, target: "es2022", sourcemap: false, chunkSizeWarningLimit: 1500 },
  server: { port: 5173, strictPort: false },
}));
