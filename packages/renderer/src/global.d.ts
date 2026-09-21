/** API exposée par la page du player (voir packages/player/src/api.ts). */
declare global {
  interface Window {
    loadProject: (data: unknown) => Promise<unknown>;
    renderFrame: (t: number) => Promise<void>;
    getDuration: () => number;
    avatarReady: Promise<void>;
  }
}
export {};
