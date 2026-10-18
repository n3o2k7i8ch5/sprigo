// Word list as CSV (#24): export with the FSRS state so a round trip keeps the schedule, import CSV/TSV including
// Anki's "Notes in Plain Text" export. Pure module, tested by src/wordsCsv.test.ts.
import type { WordCard } from "./srs";

export type CsvWord = { word: string; translation: string; card?: WordCard };
export type CsvError = { line: number; reason: "columns" | "word" | "translation" | "schedule" };

const CARD = ["due", "stability", "difficulty", "reps", "lapses", "state", "last_review"] as const;
const HEAD = ["word", "translation", ...CARD];

const cell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** Header row + one row per word. Anki imports it as is: the first two columns map to Front and Back. */
export const toCsv = (words: CsvWord[]) =>
  [HEAD, ...words.map((w) => [w.word, w.translation, ...CARD.map((k) => w.card?.[k])])].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

/** RFC 4180 rows, each with the line it starts on. Quoted fields may hold the separator, quotes and newlines. */
function rows(text: string, sep: string) {
  const out: { line: number; cells: string[] }[] = [];
  let cells: string[] = [], f = "", q = false, line = 1, start = 1, i = 0;
  const end = () => { cells.push(f); f = ""; };
  for (; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
      else if (c === '"') q = false;
      else { if (c === "\n") line++; f += c; }
    } else if (c === '"' && f === "") q = true;
    else if (c === sep) end();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      end(); out.push({ line: start, cells }); cells = []; start = ++line;
    } else f += c;
  }
  if (f || cells.length) { end(); out.push({ line: start, cells }); }
  return out;
}

// Anki exports keep HTML and [sound:…] tags in fields.
const ENT: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
const plain = (s: string) => s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").replace(/\[sound:[^\]]*\]/g, "")
  .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (_, e) => ENT[e]).replace(/[ \t]+/g, " ").trim();

const DATE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
function card(get: (k: string) => string): WordCard | null | undefined {
  if (CARD.every((k) => !get(k))) return undefined; // no schedule: a New card
  const n = (k: string) => (get(k) === "" ? NaN : Number(get(k)));
  const c = { due: get("due"), stability: n("stability"), difficulty: n("difficulty"), reps: n("reps"), lapses: n("lapses"), state: n("state"), last_review: get("last_review") || null };
  const ok = DATE.test(c.due) && (c.last_review === null || DATE.test(c.last_review)) && [c.stability, c.difficulty, c.reps, c.lapses].every((x) => x >= 0)
    && Number.isInteger(c.reps) && Number.isInteger(c.lapses) && [0, 1, 2, 3].includes(c.state);
  return ok ? c : null;
}

/** Words in a CSV/TSV file. Without a `word` header the first two columns are word and translation. A word listed twice keeps its last row. */
export function parseWords(text: string): { words: CsvWord[]; errors: CsvError[] } {
  text = text.replace(/^﻿/, "");
  // Anki: "#separator:tab", "#html:true", … lines first.
  const meta = /^#separator:(\w+)/m.exec(text)?.[1]?.toLowerCase();
  const first = text.split(/\r?\n/).find((l) => l && !l.startsWith("#")) ?? "";
  const sep = ({ tab: "\t", comma: ",", semicolon: ";", pipe: "|" } as Record<string, string>)[meta ?? ""] ?? (first.includes("\t") ? "\t" : first.includes(";") && !first.includes(",") ? ";" : ",");
  const all = rows(text, sep).filter((r) => !(r.cells.length === 1 && (r.cells[0].trim() === "" || r.cells[0].startsWith("#"))));
  const head = all[0]?.cells.map((c) => c.trim().toLowerCase());
  const named = head?.[0] === "word";
  const col = (name: string, i: number) => (named ? head!.indexOf(name) : i);
  const wordAt = col("word", 0), trAt = col("translation", 1);
  const found = new Map<string, CsvWord>(), errors: CsvError[] = [];
  for (const r of named ? all.slice(1) : all) {
    const get = (k: string) => { const i = head!.indexOf(k); return i < 0 ? "" : (r.cells[i] ?? "").trim(); };
    if (r.cells.length < 2 || trAt < 0) { errors.push({ line: r.line, reason: "columns" }); continue; }
    const word = plain(r.cells[wordAt] ?? ""), translation = plain(r.cells[trAt] ?? "");
    if (!word) { errors.push({ line: r.line, reason: "word" }); continue; }
    if (!translation) { errors.push({ line: r.line, reason: "translation" }); continue; }
    const c = named ? card(get) : undefined;
    if (c === null) { errors.push({ line: r.line, reason: "schedule" }); continue; }
    found.delete(word);
    found.set(word, c ? { word, translation, card: c } : { word, translation });
  }
  return { words: [...found.values()], errors };
}
