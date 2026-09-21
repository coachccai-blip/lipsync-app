import type { Word } from "@avatar/shared";

/** Normalise un mot pour la comparaison : minuscules, sans accents ni ponctuation. */
export function normalizeToken(w: string): string {
  return w
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function similar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  if (a.startsWith(b) || b.startsWith(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length) >= 0.6;
  // distance d'édition tolérante pour les mots longs seulement (noms propres, accords)
  const len = Math.max(a.length, b.length);
  if (len < 6) return false;
  return levenshtein(a, b) <= Math.floor(len / 4);
}

function levenshtein(a: string, b: string): number {
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Alignement de séquences (plus longue sous-séquence commune, tolérant aux petites
 * différences) entre les mots du script et ceux reconnus par Whisper.
 * Renvoie, pour chaque mot du script, l'index du mot Whisper correspondant ou -1.
 */
export function alignSequences(scriptWords: string[], asrWords: string[]): number[] {
  const a = scriptWords.map(normalizeToken);
  const b = asrWords.map(normalizeToken);
  const n = a.length;
  const m = b.length;
  // LCS par programmation dynamique (n*m ; suffisant pour quelques milliers de mots)
  const dp: Uint16Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] && similar(a[i], b[j])) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const match = new Array<number>(n).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] && similar(a[i], b[j])) {
      match[i] = j;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return match;
}

/**
 * Reporte les horodatages Whisper sur les mots du script. Les mots sans correspondance
 * sont interpolés entre leurs voisins alignés, proportionnellement à leur longueur.
 */
export function alignScriptToAsr(scriptWords: string[], asrWords: Word[], duration: number): { words: Word[]; matched: number } {
  const match = alignSequences(scriptWords, asrWords.map((w) => w.w));
  const n = scriptWords.length;
  const out: Word[] = scriptWords.map((w) => ({ w, start: 0, end: 0 }));
  let matched = 0;
  for (let i = 0; i < n; i++) {
    if (match[i] >= 0) {
      out[i].start = asrWords[match[i]].start;
      out[i].end = asrWords[match[i]].end;
      matched++;
    }
  }
  // interpolation des trous
  let i = 0;
  while (i < n) {
    if (match[i] >= 0) {
      i++;
      continue;
    }
    let k = i;
    while (k < n && match[k] < 0) k++;
    const gapStart = i > 0 ? out[i - 1].end : (asrWords[0]?.start ?? 0);
    const gapEnd = k < n ? out[k].start : Math.max(gapStart, asrWords[asrWords.length - 1]?.end ?? duration);
    const total = scriptWords.slice(i, k).reduce((s, w) => s + Math.max(1, normalizeToken(w).length), 0);
    let cursor = gapStart;
    const span = Math.max(0, gapEnd - gapStart);
    for (let q = i; q < k; q++) {
      const share = (Math.max(1, normalizeToken(scriptWords[q]).length) / total) * span;
      out[q].start = round(cursor);
      out[q].end = round(cursor + share);
      cursor += share;
    }
    i = k;
  }
  // monotonie
  for (let q = 1; q < n; q++) {
    if (out[q].start < out[q - 1].end) out[q].start = out[q - 1].end;
    if (out[q].end < out[q].start) out[q].end = out[q].start;
  }
  return { words: out, matched };
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Découpe une liste de mots horodatés en phrases (ponctuation forte). */
export function splitSentences(words: Word[]): { text: string; start: number; end: number; words: Word[] }[] {
  const sentences: { text: string; start: number; end: number; words: Word[] }[] = [];
  let current: Word[] = [];
  for (const w of words) {
    current.push(w);
    if (/[.!?…]["»)]?$/.test(w.w)) {
      sentences.push(build(current));
      current = [];
    }
  }
  if (current.length) sentences.push(build(current));
  return sentences;
  function build(ws: Word[]) {
    return { text: ws.map((x) => x.w).join(" "), start: ws[0].start, end: ws[ws.length - 1].end, words: ws };
  }
}
