import { describe, expect, it } from "vitest";
import { Prng } from "../src/prng.js";

describe("Prng", () => {
  it("est déterministe pour une même seed", () => {
    const a = new Prng(42);
    const b = new Prng(42);
    const sa = Array.from({ length: 10 }, () => a.next());
    const sb = Array.from({ length: 10 }, () => b.next());
    expect(sa).toEqual(sb);
  });

  it("produit des valeurs dans [0, 1)", () => {
    const p = new Prng(7);
    for (let i = 0; i < 1000; i++) {
      const v = p.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("change de séquence avec la seed et les forks", () => {
    expect(new Prng(1).next()).not.toBe(new Prng(2).next());
    const root = new Prng(5);
    expect(root.fork("a").next()).not.toBe(root.fork("b").next());
    expect(root.fork("a").next()).toBe(new Prng(5).fork("a").next());
  });
});
