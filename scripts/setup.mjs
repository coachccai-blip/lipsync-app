#!/usr/bin/env node
/**
 * scripts/setup : vérifie ffmpeg et Chrome, télécharge Rhubarb Lip Sync dans tools/rhubarb,
 * indique comment installer whisper.cpp. Relançable sans risque.
 */
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tools = path.join(root, "tools");
const RHUBARB_VERSION = process.env.RHUBARB_VERSION ?? "1.14.0";
const ok = (m) => console.log(`  ✔ ${m}`);
const warn = (m) => console.log(`  ⚠ ${m}`);

function which(names) {
  for (const n of names) {
    const r = spawnSync(os.platform() === "win32" ? "where" : "which", [n], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split(/\r?\n/)[0];
  }
  return undefined;
}

function exists(p) {
  return p && existsSync(p);
}

console.log("\nAvatar Studio — vérification de l'environnement\n");
console.log(`Node ${process.version} (${os.platform()} ${os.arch()})`);
if (Number(process.versions.node.split(".")[0]) < 20) warn("Node 20 ou plus est requis.");

// ffmpeg
const ffmpeg = process.env.FFMPEG_PATH ?? which(["ffmpeg"]);
if (exists(ffmpeg) || (ffmpeg && !ffmpeg.includes(path.sep))) {
  const v = spawnSync(ffmpeg, ["-version"], { encoding: "utf8" }).stdout?.split("\n")[0];
  ok(`ffmpeg : ${ffmpeg} (${v})`);
  const enc = spawnSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout ?? "";
  for (const [name, use] of [["libx264", "mp4"], ["prores_ks", "prores4444"], ["libvpx-vp9", "webm-alpha"], ["aac", "audio mp4"], ["libopus", "audio webm"]]) {
    if (!enc.includes(name)) warn(`ffmpeg sans l'encodeur ${name} (format ${use})`);
  }
} else {
  warn("ffmpeg introuvable : apt install ffmpeg / brew install ffmpeg / https://ffmpeg.org, ou FFMPEG_PATH dans .env");
}

// Rhubarb
const rhubarbLocal = path.join(tools, "rhubarb", os.platform() === "win32" ? "rhubarb.exe" : "rhubarb");
const rhubarb = process.env.RHUBARB_PATH ?? (existsSync(rhubarbLocal) ? rhubarbLocal : which(["rhubarb"]));
if (exists(rhubarb) || (rhubarb && !rhubarb.includes(path.sep))) ok(`rhubarb : ${rhubarb}`);
else {
  const platform = { linux: "Linux", darwin: "macOS", win32: "Windows" }[os.platform()];
  if (!platform) warn(`Rhubarb : pas de binaire pour ${os.platform()} ; compilez-le depuis https://github.com/DanielSWolf/rhubarb-lip-sync`);
  else {
    const archive = `Rhubarb-Lip-Sync-${RHUBARB_VERSION}-${platform}.zip`;
    const url = `https://github.com/DanielSWolf/rhubarb-lip-sync/releases/download/v${RHUBARB_VERSION}/${archive}`;
    console.log(`  … téléchargement de ${url}`);
    try {
      mkdirSync(tools, { recursive: true });
      const zip = path.join(tools, archive);
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));
      const extractDir = path.join(tools, "rhubarb-extract");
      rmSync(extractDir, { recursive: true, force: true });
      mkdirSync(extractDir, { recursive: true });
      const unzip = os.platform() === "win32" ? spawnSync("tar", ["-xf", zip, "-C", extractDir]) : spawnSync("unzip", ["-q", zip, "-d", extractDir]);
      if (unzip.status !== 0) throw new Error("décompression impossible (unzip / tar requis)");
      const inner = readdirSync(extractDir).map((d) => path.join(extractDir, d)).find((d) => statSync(d).isDirectory()) ?? extractDir;
      rmSync(path.join(tools, "rhubarb"), { recursive: true, force: true });
      renameSync(inner, path.join(tools, "rhubarb"));
      rmSync(extractDir, { recursive: true, force: true });
      rmSync(zip, { force: true });
      if (os.platform() !== "win32") chmodSync(rhubarbLocal, 0o755);
      ok(`rhubarb installé : ${rhubarbLocal}`);
    } catch (e) {
      warn(`Rhubarb : téléchargement impossible (${e.message}). Téléchargez ${archive} depuis https://github.com/DanielSWolf/rhubarb-lip-sync/releases et dézippez-le dans tools/rhubarb/ (ou définissez RHUBARB_PATH).`);
    }
  }
}

// Chrome
const chromeCandidates = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  path.join(process.env["PROGRAMFILES"] ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
  path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
];
const chromeCache = path.join(os.homedir(), ".cache", "puppeteer", "chrome");
if (existsSync(chromeCache)) for (const d of readdirSync(chromeCache)) chromeCandidates.push(path.join(chromeCache, d, "chrome-linux64", "chrome"), path.join(chromeCache, d, "chrome-win64", "chrome.exe"), path.join(chromeCache, d, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"));
const chrome = chromeCandidates.find((c) => exists(c));
if (chrome) ok(`chrome : ${chrome}`);
else if (process.argv.includes("--no-chrome")) warn("Chrome introuvable (téléchargement désactivé)");
else {
  console.log("  … Chrome introuvable : téléchargement de Chrome for Testing (npx @puppeteer/browsers)");
  const r = spawnSync("npx", ["--yes", "@puppeteer/browsers", "install", "chrome@stable"], { stdio: "inherit", shell: true });
  if (r.status === 0) ok("Chrome téléchargé dans ~/.cache/puppeteer");
  else warn("Téléchargement impossible : installez Google Chrome et définissez CHROME_PATH dans .env");
}

// whisper.cpp
const whisper = process.env.WHISPER_BIN ?? which(["whisper-cli", "whisper-cpp"]);
if (whisper) ok(`whisper.cpp : ${whisper}`);
else warn("whisper.cpp introuvable. Installation : brew install whisper-cpp (macOS) ou compilez https://github.com/ggml-org/whisper.cpp (binaire whisper-cli), puis WHISPER_BIN dans .env");
const model = process.env.WHISPER_MODEL;
if (model && existsSync(model)) ok(`modèle Whisper : ${model}`);
else warn("WHISPER_MODEL non défini ou introuvable : téléchargez ggml-small.bin (ou medium) depuis https://huggingface.co/ggerganov/whisper.cpp/tree/main et renseignez WHISPER_MODEL dans .env");

// modèle 3D
const glb = path.join(root, "assets", "models");
const models = existsSync(glb) ? readdirSync(glb).filter((f) => /\.glb$/i.test(f)) : [];
if (models.length) ok(`modèles GLB : ${models.join(", ")} (config/scene.json → model)`);
else warn("aucun GLB dans assets/models/ : le personnage de substitution sera utilisé");

if (!existsSync(path.join(root, ".env"))) warn("pas de fichier .env : copiez .env.example et renseignez les clés (Azure, Anthropic)");
console.log("\nTerminé. Étape suivante : npm run build, puis npm run avatar -- check\n");
