const ts = () => new Date().toISOString().slice(11, 19);

export const log = {
  info: (msg: string) => console.error(`[${ts()}] ${msg}`),
  step: (msg: string) => console.error(`\n[${ts()}] ▶ ${msg}`),
  warn: (msg: string) => console.error(`[${ts()}] ⚠ ${msg}`),
  error: (msg: string) => console.error(`[${ts()}] ✖ ${msg}`),
  done: (msg: string) => console.error(`[${ts()}] ✔ ${msg}`),
};
