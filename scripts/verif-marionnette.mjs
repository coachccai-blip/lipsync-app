#!/usr/bin/env node
/**
 * Vérification des combinaisons de calques de la marionnette : émotion × bouche × clignement ×
 * regard × sourcils × mains. Ouvre le studio en Chrome headless, force chaque état, contrôle
 * automatiquement que rien ne change hors de la zone de chaque calque, et écrit une vignette
 * par combinaison plus des planches de contrôle.
 *
 *   node scripts/verif-marionnette.mjs [projet=marionnette] [dossier de sortie=verif-marionnette]
 *
 * Nécessite Chrome (CHROME_PATH ou détection automatique) et un projet préparé avec ce modèle.
 */
import puppeteer from "puppeteer-core";
import path from "node:path";
import { findChrome } from "@avatar/renderer";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
const project = process.argv[2] ?? "marionnette";
const outDir = path.resolve(process.argv[3] ?? "verif-marionnette");
fs.mkdirSync(outDir, { recursive: true });
const port = 4183;
const server = spawn(process.execPath, ["packages/cli/dist/index.js", "studio", "--port", String(port), "--no-open"], { cwd: process.cwd(), stdio: "pipe" });
let browser;
try {
  await sleep(2500);
  const executablePath = process.env.CHROME_PATH ?? findChrome();
  if (!executablePath) throw new Error("Chrome introuvable : définissez CHROME_PATH");
  browser = await puppeteer.launch({ executablePath, headless: true, protocolTimeout: 600000, args: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--proxy-server=direct://"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  page.on("pageerror", e => console.log("[pageerror]", e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html?mode=studio&project=${encodeURIComponent(project)}`, { waitUntil: "load", timeout: 60000 });
  await page.evaluate(() => window.avatarReady);
  await sleep(1500);
  const result = await page.evaluate(async () => {
    const s = window.__studio; const p = s.player; const puppet = p.puppet;
    const orig = p.animator.frameAt;
    const still = { head: [0, 0, 0], spine1: [0, 0, 0], spine2: [0, 0, 0] };
    let o = {};
    p.animator.frameAt = (t) => ({ ...orig(t), bones: still, headLag: [0, 0, 0], blink: o.blink ?? 0, shapes: o.shapes ?? {}, emotionDisplayed: o.emotion, emotions: o.emotions ?? {}, gaze: o.gaze ?? { x: 0, y: 0 }, brow: o.brow ?? 0, gesture: o.gesture, speaking: 1 });
    const canvas = p.captureCanvas(); const d = canvas.width; const ctx2 = canvas.getContext("2d");
    const render = async (ov) => { o = ov; s.lastFrame = -1; await p.renderFrame(0.3); return ctx2.getImageData(0, 0, d, d).data; };
    // zones (px source -> px canvas) ; tête immobile, centrée
    const W = puppet.width; const scale = (d / W) * s.cfg.scene.marionnette.zoom;
    const toC = (r) => ({ x: (r.x - W / 2) * scale + d / 2, y: (r.y - W / 2) * scale + d / 2, w: r.w * scale, h: r.h * scale });
    const reg = puppet.regions; const pad = 18 * scale + 12;
    const zones = { mouth: toC(reg.mouth), eyes: toC(reg.eyes), brows: reg.brows ? toC(reg.brows) : null };
    const inside = (x, y, r) => r && x >= r.x - pad && x < r.x + r.w + pad && y >= r.y - pad && y < r.y + r.h + pad;
    const neutral = await render({});
    const combos = [];
    const shapes = ["X", "A", "B", "C", "D", "E", "F", "G", "H"];
    const emotions = [undefined, "enjoué", "surpris", "sérieux", "pensif"];
    for (const emotion of emotions) for (const sh of shapes) for (const blink of [0, 0.5, 1]) combos.push({ name: `E${emotion ?? "base"}_M${sh}_B${blink}`, ov: { emotion, shapes: sh === "X" ? {} : { [sh]: 1 }, blink } });
    for (const gaze of [["none", { x: 0, y: 0 }], ["left", { x: -0.6, y: 0 }], ["right", { x: 0.6, y: 0 }], ["up", { x: 0, y: 0.6 }]]) for (const brow of [0, 1]) for (const blink of [0, 0.5, 1]) for (const sh of ["X", "D"]) combos.push({ name: `G${gaze[0]}_S${brow}_B${blink}_M${sh}`, ov: { gaze: gaze[1], brow, blink, shapes: sh === "X" ? {} : { [sh]: 1 } } });
    for (const brow of [1]) for (const em of [{ "sérieux": 0.2 }]) combos.push({ name: `Sfronces`, ov: { brow, emotions: em } });
    for (const hand of ["salut", "explication", "index", "approbation"]) for (const emotion of [undefined, "enjoué", "surpris"]) for (const sh of ["X", "D"]) for (const w of [1, 0.5]) combos.push({ name: `H${hand}_E${emotion ?? "base"}_M${sh}_W${w}`, ov: { gesture: { clip: hand, weight: w }, emotion, shapes: sh === "X" ? {} : { [sh]: 1 } } });
    const out = []; const tiles = {};
    for (const c of combos) {
      const img = await render(c.ov);
      // pixels modifiés hors zones autorisées
      let leak = 0, changed = 0, speckles = 0;
      const allowHands = Boolean(c.ov.gesture);
      for (let y = 0; y < d; y += 2) for (let x = 0; x < d; x += 2) {
        const i = (y * d + x) * 4;
        const diff = Math.max(Math.abs(img[i] - neutral[i]), Math.abs(img[i + 1] - neutral[i + 1]), Math.abs(img[i + 2] - neutral[i + 2]), Math.abs(img[i + 3] - neutral[i + 3]));
        if (allowHands && neutral[i + 3] < 8 && img[i + 3] > 8 && img[i + 3] < 200) speckles++;
        if (diff <= 30) continue;
        changed++;
        const okZone = inside(x, y, zones.mouth) || inside(x, y, zones.eyes) || inside(x, y, zones.brows);
        const faceCenter = Math.hypot(x - d / 2, y - d * 0.42) < d * 0.22; // visage : interdit aux mains
        if (!okZone && !(allowHands && !faceCenter)) leak++;
      }
      out.push({ name: c.name, changed, leak, speckles });
      // vignette visage
      const crop = document.createElement("canvas"); crop.width = 200; crop.height = 270;
      const fx = d * 0.28, fy = d * 0.14, fw = d * 0.46, fh = d * 0.62;
      crop.getContext("2d").drawImage(canvas, fx, fy, fw, fh, 0, 0, 200, 270);
      tiles[c.name] = crop.toDataURL("image/png");
    }
    p.animator.frameAt = orig;
    return { out, tiles, zones, d };
  });
  fs.writeFileSync(path.join(outDir, "resultats.json"), JSON.stringify(result.out, null, 1));
  for (const [n, data] of Object.entries(result.tiles)) fs.writeFileSync(path.join(outDir, `${n}.png`), Buffer.from(data.split(",")[1], "base64"));
  const leaks = result.out.filter(r => r.leak > 0);
  console.log("combinaisons :", result.out.length, "; avec fuite hors zone :", leaks.length, "(le champ speckles de resultats.json compte les pixels semi-transparents ajoutés par les mains, bords anti-aliasés compris)");
  for (const l of leaks.slice(0, 20)) console.log("  ", l.name, "leak", l.leak, "changed", l.changed);
  console.log("vignettes et resultats.json dans", outDir);
  process.exitCode = leaks.length ? 1 : 0;
} finally { await browser?.close(); server.kill(); }
