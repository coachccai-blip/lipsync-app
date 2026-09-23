import { describe, expect, it } from "vitest";
import { approximateLipsync, fft } from "../src/dsp.js";

function tone(freq: number, sr: number, seconds: number, amp = 0.5): Float32Array {
  const n = Math.round(sr * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

describe("dsp", () => {
  it("la FFT trouve la fréquence d'un sinus", () => {
    const N = 1024;
    const sr = 16000;
    const re = tone(1000, sr, N / sr, 1);
    const im = new Float32Array(N);
    fft(re, im);
    let best = 0;
    let bestMag = 0;
    for (let k = 0; k < N / 2; k++) {
      const m = re[k] * re[k] + im[k] * im[k];
      if (m > bestMag) {
        bestMag = m;
        best = k;
      }
    }
    expect(Math.abs((best * sr) / N - 1000)).toBeLessThan(sr / N + 1);
  });

  it("le lip sync approximatif couvre toute la durée, ferme la bouche dans le silence et l'ouvre sur le son", () => {
    const sr = 16000;
    const silence = new Float32Array(sr); // 1 s
    const voice = tone(300, sr, 1, 0.6); // 1 s grave et fort → E ou D
    const samples = new Float32Array(silence.length + voice.length + silence.length);
    samples.set(voice, silence.length);
    const cues = approximateLipsync(samples, sr);
    expect(cues[0]).toMatchObject({ start: 0, shape: "X" });
    expect(cues[cues.length - 1].end).toBeCloseTo(3, 1);
    for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBeCloseTo(cues[i - 1].end, 5);
    const at = (t: number) => cues.find((c) => t >= c.start && t < c.end)!;
    expect(at(1.5).shape).not.toBe("X");
    expect(at(0.5).shape).toBe("X");
    expect(at(2.5).shape).toBe("X");
  });
});
