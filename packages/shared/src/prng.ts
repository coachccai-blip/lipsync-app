/**
 * Générateur pseudo-aléatoire déterministe (mulberry32).
 * Tout l'aléatoire de l'animation passe par ici, initialisé par la `seed` du projet.
 */
export class Prng {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** Nombre dans [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Nombre dans [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Vrai avec la probabilité p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Dérive un générateur indépendant pour un sous-système (clignements, regard...). */
  fork(label: string): Prng {
    let h = this.state ^ 0x811c9dc5;
    for (let i = 0; i < label.length; i++) {
      h = Math.imul(h ^ label.charCodeAt(i), 0x01000193);
    }
    return new Prng(h >>> 0);
  }
}
