const ts = () => new Date().toISOString().slice(11, 19);

export type LogLevel = "info" | "step" | "warn" | "error" | "done";
export type LogListener = (level: LogLevel, message: string) => void;

const listeners = new Set<LogListener>();

function emit(level: LogLevel, msg: string): void {
  const prefix = { info: "", step: "▶ ", warn: "⚠ ", error: "✖ ", done: "✔ " }[level];
  console.error(`${level === "step" ? "\n" : ""}[${ts()}] ${prefix}${msg}`);
  for (const l of listeners) {
    try {
      l(level, msg);
    } catch {
      /* un écouteur défaillant n'interrompt pas le pipeline */
    }
  }
}

/** Journal du pipeline : sortie standard d'erreur + écouteurs (studio, tests). */
export const log = {
  info: (msg: string) => emit("info", msg),
  step: (msg: string) => emit("step", msg),
  warn: (msg: string) => emit("warn", msg),
  error: (msg: string) => emit("error", msg),
  done: (msg: string) => emit("done", msg),
  /** Abonne un écouteur ; renvoie la fonction de désabonnement. */
  listen(l: LogListener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
