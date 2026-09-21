export interface TtsResult {
  /** PCM 16 bits mono. */
  pcm: Buffer;
  sampleRate: number;
}

/** Fournisseur de synthèse vocale. Changer de fournisseur = ajouter une classe ici. */
export interface TtsProvider {
  readonly name: string;
  /** Identifiant stable de la configuration (voix, température...) pour le cache. */
  configKey(): string;
  /** Vérifie la disponibilité (voix, région...). Lève une erreur explicite sinon. */
  check(): Promise<void>;
  synthesize(text: string): Promise<TtsResult>;
}
