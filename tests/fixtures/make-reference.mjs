// Génère tests/fixtures/reference.wav : 2,4 s à 16 kHz, quatre « syllabes » (bourdon
// modulé) séparées par des silences. Sert de WAV de référence versionné pour les tests.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sr = 16000;
const duration = 2.4;
const n = Math.round(sr * duration);
const samples = new Float32Array(n);
const bursts = [
  [0.3, 0.55, 0.9],
  [0.7, 0.95, 0.5],
  [1.2, 1.5, 1.0],
  [1.8, 2.0, 0.6],
];
for (const [start, end, amp] of bursts) {
  for (let i = Math.round(start * sr); i < Math.round(end * sr); i++) {
    const t = i / sr;
    const env = Math.sin(Math.PI * ((t - start) / (end - start)));
    samples[i] = amp * env * (0.6 * Math.sin(2 * Math.PI * 140 * t) + 0.3 * Math.sin(2 * Math.PI * 280 * t) + 0.1 * Math.sin(2 * Math.PI * 700 * t));
  }
}
const pcm = Buffer.alloc(n * 2);
for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
const header = Buffer.alloc(44);
header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
header.writeUInt32LE(sr, 24); header.writeUInt32LE(sr * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
writeFileSync(path.join(here, "reference.wav"), Buffer.concat([header, pcm]));
console.log("reference.wav écrit");
