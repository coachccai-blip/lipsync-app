import { describe, expect, it } from "vitest";
import { decodeSimplePng, encodePng, pngSize } from "../src/png.js";
import { DEFAULT_ZONES, IMAGE_SPECS, buildManifest, buildMask, openaiEdit, safePersonnageName } from "../src/personnage.js";

describe("png minimal", () => {
  it("encode puis décode à l'identique", () => {
    const w = 5;
    const h = 3;
    const rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 37) % 256);
    const png = encodePng(w, h, rgba);
    expect(pngSize(png)).toEqual({ width: w, height: h });
    const back = decodeSimplePng(png);
    expect(Array.from(back.rgba)).toEqual(Array.from(rgba));
  });
});

describe("masques d'édition", () => {
  const size = 64;
  const alphaAt = (png: Buffer, fx: number, fy: number) => {
    const { rgba } = decodeSimplePng(png);
    const x = Math.floor(fx * size);
    const y = Math.floor(fy * size);
    return rgba[(y * size + x) * 4 + 3];
  };
  it("bouche : transparent dans le rectangle, opaque ailleurs", () => {
    const m = buildMask("bouche", DEFAULT_ZONES, size);
    expect(alphaAt(m, 0.5, 0.62)).toBe(0);
    expect(alphaAt(m, 0.5, 0.4)).toBe(255);
    expect(alphaAt(m, 0.05, 0.9)).toBe(255);
  });
  it("mains : visage conservé, bas et côtés éditables, haut conservé", () => {
    const m = buildMask("mains", DEFAULT_ZONES, size);
    expect(alphaAt(m, 0.5, 0.42)).toBe(255); // visage
    expect(alphaAt(m, 0.5, 0.05)).toBe(255); // au-dessus de la tête, centré
    expect(alphaAt(m, 0.1, 0.9)).toBe(0); // bas gauche
    expect(alphaAt(m, 0.9, 0.5)).toBe(0); // côté droit
  });
});

describe("spécification des images", () => {
  it("25 images générées (bouche_X est une copie de la base), noms uniques, une seule base", () => {
    expect(IMAGE_SPECS).toHaveLength(25);
    expect(new Set(IMAGE_SPECS.map((s) => s.file)).size).toBe(25);
    expect(IMAGE_SPECS.filter((s) => s.zone === "base")).toHaveLength(1);
  });
  it("manifeste : groupes présents seulement si les fichiers existent", () => {
    const files = ["lydia_base.png", "lydia_bouche_A.png", "lydia_bouche_D.png", "lydia_yeux_fermes.png", "lydia_emotion_enjoue.png"];
    const m = buildManifest("lydia", files) as Record<string, Record<string, string>>;
    expect(m.base).toBe("lydia_base.png");
    expect(m.mouths).toEqual({ X: "lydia_base.png", A: "lydia_bouche_A.png", D: "lydia_bouche_D.png" });
    expect(m.eyes).toEqual({ closed: "lydia_yeux_fermes.png" });
    expect(m.emotions).toEqual({ "enjoué": "lydia_emotion_enjoue.png" });
    expect(m.hands).toBeUndefined();
    expect(m.smileEmotions).toBeUndefined();
  });
  it("nom de personnage normalisé", () => {
    expect(safePersonnageName("Léa Dupont")).toBe("lea-dupont");
    expect(() => safePersonnageName("models")).toThrow();
  });
});

describe("appel OpenAI (simulé)", () => {
  it("envoie un multipart avec image, masque et prompt, et lit b64_json", async () => {
    let seen: FormData | undefined;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen = init?.body as FormData;
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("PNGDATA").toString("base64") }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await openaiEdit({ apiKey: "k", image: Buffer.from("img"), mask: Buffer.from("mask"), prompt: "bouche", size: 1024, quality: "low", fetchImpl });
    expect(out.toString()).toBe("PNGDATA");
    expect(seen?.get("model")).toBe("gpt-image-1");
    expect(seen?.get("size")).toBe("1024x1024");
    expect((seen?.get("image") as File).size).toBe(3);
    expect((seen?.get("mask") as File).size).toBe(4);
  });
  it("reprend après un 429 puis réussit", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (n === 1) return new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429 });
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("ok").toString("base64") }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await openaiEdit({ apiKey: "k", image: Buffer.alloc(1), mask: Buffer.alloc(1), prompt: "p", size: 1024, quality: "low", fetchImpl });
    expect(out.toString()).toBe("ok");
    expect(n).toBe(2);
  }, 15000);
  it("échoue sans reprise sur une erreur 400", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: "bad prompt" } }), { status: 400 })) as unknown as typeof fetch;
    await expect(openaiEdit({ apiKey: "k", image: Buffer.alloc(1), mask: Buffer.alloc(1), prompt: "p", size: 1024, quality: "low", fetchImpl })).rejects.toThrow(/400/);
  });
});

describe("generatePersonnage (API simulée, ffmpeg réel)", () => {
  it("produit les 26 images, le manifeste et la planche dans assets/<nom>/", async () => {
    const { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { generatePersonnage } = await import("../src/personnage.js");
    const root = mkdtempSync(path.join(os.tmpdir(), "perso-"));
    mkdirSync(path.join(root, "assets"), { recursive: true });
    // photo source : PNG 40×30 uni (recadré en carré par ffmpeg)
    const photo = path.join(root, "photo.png");
    writeFileSync(photo, encodePng(40, 30, new Uint8Array(40 * 30 * 4).fill(200)));
    const size = 32;
    const prompts: string[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      prompts.push(String(form.get("prompt")));
      const mask = form.get("mask") as File;
      expect(mask.size).toBeGreaterThan(0);
      const png = encodePng(size, size, new Uint8Array(size * size * 4).fill(prompts.length % 256));
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await generatePersonnage({ photo, nom: "Test Perso", root, apiKey: "k", size, quality: "low", fetchImpl });
    expect(r.model).toBe("assets/test-perso/marionnette.json");
    expect(r.files).toHaveLength(26);
    expect(prompts).toHaveLength(25);
    expect(existsSync(path.join(root, "assets", "test-perso", "test-perso_bouche_X.png"))).toBe(true);
    const manifest = JSON.parse(readFileSync(r.manifest, "utf8"));
    expect(Object.keys(manifest.mouths)).toHaveLength(9);
    expect(Object.keys(manifest.hands)).toHaveLength(4);
    expect(r.planche && existsSync(r.planche)).toBe(true);
    // reprise : rien à régénérer, sauf la cible de --seulement
    const r2 = await generatePersonnage({ photo, nom: "test-perso", root, apiKey: "k", size, quality: "low", fetchImpl, seulement: ["bouche_D"] });
    expect(prompts).toHaveLength(26);
    expect(r2.files).toHaveLength(26);
  }, 60000);
});
