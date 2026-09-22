import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestPerformance } from "@avatar/shared";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "tests", "fixtures", "reference.wav");

/**
 * API du studio (serveur local) : projets, envoi de fichiers, configuration, performance,
 * jobs et journal. Nécessite le renderer et le player construits (npm run build).
 */
describe("API du studio", () => {
  let server: { url: string; close(): Promise<void> } | undefined;
  let tmpRoot: string;
  const j = async (p: string, init?: RequestInit) => {
    const r = await fetch(`${server!.url}${p}`, init);
    const text = await r.text();
    return { status: r.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
  };

  beforeAll(async () => {
    if (!existsSync(path.join(root, "packages", "renderer", "dist", "index.js"))) return;
    // racine temporaire : config/ copiée, projets/ vide, player dist réel
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "avatar-studio-"));
    mkdirSync(path.join(tmpRoot, "config"));
    for (const f of ["scene", "visemes", "emotions", "gestures", "bones"]) writeFileSync(path.join(tmpRoot, "config", `${f}.json`), readFileSync(path.join(root, "config", `${f}.json`)));
    mkdirSync(path.join(tmpRoot, "projets", "demo"), { recursive: true });
    writeFileSync(path.join(tmpRoot, "projets", "demo", "performance.json"), JSON.stringify(makeTestPerformance(2.4, 30, 1, true)));
    writeFileSync(path.join(tmpRoot, "projets", "demo", "audio.wav"), readFileSync(fixture));
    const { startServer } = await import("@avatar/renderer");
    server = await startServer({ root: tmpRoot, playerDist: path.join(root, "packages", "player", "dist"), watch: false });
  });
  afterAll(async () => {
    await server?.close();
  });

  it("liste, crée et sert les projets", async () => {
    if (!server) return;
    const list = await j("/api/projects");
    expect(list.status).toBe(200);
    expect((list.body!.projects as { name: string }[]).map((p) => p.name)).toContain("demo");
    const created = await j("/api/projects", { method: "POST", body: JSON.stringify({ name: "Mon Projet Été" }) });
    expect(created.status).toBe(201);
    expect(created.body!.name).toBe("mon-projet-ete");
    const payload = await j("/api/project?project=demo");
    expect(payload.status).toBe(200);
    expect((payload.body!.performance as { fps: number }).fps).toBe(30);
    expect(payload.body!.audioUrl).toBe("/files/demo/audio.wav");
    const audio = await fetch(`${server.url}/files/demo/audio.wav`);
    expect(audio.headers.get("content-type")).toBe("audio/wav");
    expect((await j("/api/project?project=inconnu")).status).toBe(404);
  });

  it("reçoit un fichier source et refuse les types inconnus", async () => {
    if (!server) return;
    const ok = await j("/api/upload?project=mon-projet-ete&name=voix.wav", { method: "POST", body: readFileSync(fixture) });
    expect(ok.status).toBe(201);
    expect(ok.body!.kind).toBe("audio");
    expect(existsSync(path.join(tmpRoot, "projets", "mon-projet-ete", "source", "voix.wav"))).toBe(true);
    const bad = await j("/api/upload?project=mon-projet-ete&name=script.exe", { method: "POST", body: "x" });
    expect(bad.status).toBe(400);
  });

  it("écrit la configuration en conservant _doc et rejette les fichiers inconnus", async () => {
    if (!server) return;
    const cfg = await j("/api/config");
    const scene = { ...(cfg.body!.files as Record<string, Record<string, unknown>>).scene, fps: 25 };
    delete scene._doc;
    const put = await j("/api/config/scene", { method: "PUT", body: JSON.stringify(scene) });
    expect(put.status).toBe(200);
    const written = JSON.parse(readFileSync(path.join(tmpRoot, "config", "scene.json"), "utf8"));
    expect(written.fps).toBe(25);
    expect(typeof written._doc).toBe("string");
    expect((await j("/api/config/inconnu", { method: "PUT", body: "{}" })).status).toBe(404);
    expect((await j("/api/config/scene", { method: "PUT", body: "[1]" })).status).toBe(400);
  });

  it("valide performance.json à l'écriture avec un message lisible", async () => {
    if (!server) return;
    const perf = makeTestPerformance(2.4, 30, 1, true) as unknown as Record<string, unknown>;
    const bad = await j("/api/performance?project=demo", { method: "PUT", body: JSON.stringify({ ...perf, gestures: [{ at: 1, clip: "danse" }] }) });
    expect(bad.status).toBe(500);
    expect(String(bad.body!.error)).toContain("gestures[0].clip");
    expect((await j("/api/performance?project=demo", { method: "PUT", body: JSON.stringify(perf) })).status).toBe(200);
  });

  it("exécute un job de préparation et diffuse son journal (échec propre sans Rhubarb)", async () => {
    if (!server) return;
    process.env.RHUBARB_PATH = "/chemin/inexistant/rhubarb";
    delete process.env.WHISPER_BIN;
    expect((await j("/api/jobs", { method: "POST", body: JSON.stringify({ type: "danse", project: "demo" }) })).status).toBe(400);
    const job = await j("/api/jobs", { method: "POST", body: JSON.stringify({ type: "prepare", project: "mon-projet-ete", options: { kind: "audio", file: "voix.wav", sansLlm: true } }) });
    expect(job.status).toBe(201);
    const id = job.body!.id as string;
    // attendre la fin
    let status = "";
    let detail: Record<string, unknown> = {};
    for (let i = 0; i < 100 && !["termine", "erreur", "annule"].includes(status); i++) {
      await new Promise((r) => setTimeout(r, 200));
      detail = (await j(`/api/jobs/${id}`)).body!;
      status = String(detail.status);
    }
    expect(status).toBe("erreur");
    const events = detail.events as { type: string; message?: string; level?: string }[];
    expect(events.some((e) => e.type === "log" && e.level === "step")).toBe(true);
    expect(String(detail.error)).toMatch(/whisper|rhubarb/i);
    const sse = await fetch(`${server.url}/api/jobs/${id}/events`);
    const text = await sse.text();
    expect(text).toContain('"type":"status"');
    expect(text).toContain('"status":"erreur"');
  }, 60_000);
});
