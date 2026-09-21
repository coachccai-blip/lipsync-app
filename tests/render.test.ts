import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestPerformance } from "@avatar/shared";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "tests", "fixtures", "reference.wav");

/**
 * Test de déterminisme du jalon 2 : même performance.json et même seed → mêmes hash d'images.
 * Nécessite Chrome, ffmpeg et le player construit (npm run build) ; ignoré sinon.
 */
describe("rendu déterministe (Chrome + player construit requis)", () => {
  let available = false;
  let renderer: typeof import("@avatar/renderer");
  beforeAll(async () => {
    process.env.AVATAR_ROOT = root;
    if (!existsSync(path.join(root, "packages", "renderer", "dist", "index.js"))) return;
    renderer = await import("@avatar/renderer");
    available = !!renderer.findChrome() && existsSync(path.join(root, "packages", "player", "dist", "index.html"));
  });

  it("deux rendus successifs donnent des images identiques octet pour octet", async () => {
    if (!available) return;
    const dir = mkdtempSync(path.join(os.tmpdir(), "avatar-render-"));
    const perf = makeTestPerformance(2.4, 30, 4242, true);
    writeFileSync(path.join(dir, "performance.json"), JSON.stringify(perf));
    writeFileSync(path.join(dir, "audio.wav"), await import("node:fs").then((fs) => fs.readFileSync(fixture)));
    const opts = { projectDir: dir, format: "mp4" as const, debut: 0.5, fin: 0.7, skipEncode: true, quiet: true, root };
    const a = await renderer.renderProject(opts);
    const b = await renderer.renderProject(opts);
    expect(a.frames).toBe(6);
    expect(a.hashes).toEqual(b.hashes);
    expect(new Set(a.hashes).size).toBeGreaterThan(1);
  }, 180_000);
});
