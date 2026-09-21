import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";

/** Cherche un exécutable Chrome / Chromium : CHROME_PATH, cache Puppeteer, emplacements usuels. */
export function findChrome(): string | undefined {
  const fromEnv = process.env.CHROME_PATH ?? process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const candidates: string[] = [];
  const platform = os.platform();
  const cache = path.join(os.homedir(), ".cache", "puppeteer", "chrome");
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).sort().reverse()) {
      candidates.push(
        path.join(cache, dir, "chrome-linux64", "chrome"),
        path.join(cache, dir, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        path.join(cache, dir, "chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        path.join(cache, dir, "chrome-win64", "chrome.exe"),
      );
    }
  }
  if (platform === "linux") {
    candidates.push("/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium", "/opt/pw-browsers/chromium");
    const pw = process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(os.homedir(), ".cache", "ms-playwright");
    if (existsSync(pw)) for (const d of readdirSync(pw)) if (d.startsWith("chromium")) candidates.push(path.join(pw, d, "chrome-linux", "chrome"));
  } else if (platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium");
  } else if (platform === "win32") {
    for (const base of [process.env["PROGRAMFILES"], process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]) {
      if (base) candidates.push(path.join(base, "Google", "Chrome", "Application", "chrome.exe"));
    }
  }
  return candidates.find((c) => existsSync(c));
}

/** Lance Chrome headless avec les options nécessaires au WebGL (ANGLE + SwiftShader en repli). */
export async function launchChrome(options: { executablePath?: string; gpu?: boolean } = {}): Promise<Browser> {
  const executablePath = options.executablePath ?? findChrome();
  if (!executablePath) {
    throw new Error("Chrome introuvable. Installez Google Chrome, lancez `npm run setup`, ou définissez CHROME_PATH.");
  }
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--mute-audio",
    "--force-device-scale-factor=1",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ];
  if (options.gpu === false) args.push("--use-gl=angle", "--use-angle=swiftshader");
  else args.push("--use-gl=angle", "--use-angle=default");
  return puppeteer.launch({ executablePath, headless: true, args, protocolTimeout: 600_000 });
}
