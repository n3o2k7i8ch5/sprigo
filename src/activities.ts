// Activity registry (PLAN §3.2): per YAML type, what the AI must write (zod schema + guide) and how it
// maps onto the five lesson renderers. Pure module, tested by src/activities.test.ts.
import { z } from "zod";
import type { Cefr, Course, CourseLevel } from "./course";

export type Item =
  | { kind: "learn"; phrase: string; translation: string; note: string }
  | { kind: "choice"; prompt: string; context: string; big: boolean; listen: string; options: string[]; answer: number }
  | { kind: "bank"; prompt: string; answer: string[]; bank: string[] }
  | { kind: "input"; prompt: string; context: string; listen: string; answer: string; accepted: string[] }
  | { kind: "match"; pairs: [string, string][] }
  | { kind: "speak"; phrase: string; translation: string };

const s = z.string();
const options = z.array(s).min(3).max(4);
const idx = z.int().min(0).max(3);

type Def = { guide: string; schema: z.ZodType; toItem: (g: any) => Item | null };

const choice = (guide: string, extra: Record<string, z.ZodType>, map: (g: any) => { context?: string; big?: boolean; listen?: string }): Def => ({
  guide,
  schema: z.object({ prompt: s, ...extra, options, answer_index: idx }),
  toItem: (g) => {
    if (g.answer_index >= g.options.length || new Set(g.options).size !== g.options.length || givesAway(g.prompt, g.options, g.answer_index)) return null;
    const m = map(g);
    return { kind: "choice", prompt: g.prompt, context: m.context ?? "", big: !!m.big, listen: m.listen ?? "", ...shuffleAnswer(g.options, g.answer_index) };
  },
});

export const REGISTRY: Partial<Record<string, Def>> = {
  speak: {
    guide: "A short target-language sentence (3–8 words) from this step for the learner to say aloud, plus its translation. Everyday wording, no names or numbers.",
    schema: z.object({ sentence: s, translation: s }),
    toItem: (g) => ({ kind: "speak", phrase: g.sentence, translation: g.translation }),
  },
  learn: {
    guide: "Teach one new word or phrase from the step: the target-language phrase, its translation, and a one-sentence usage note in the native language.",
    schema: z.object({ phrase: s, translation: s, note: s }),
    toItem: (g) => ({ kind: "learn", ...g }),
  },
  word_select: choice("Ask for the target-language word that matches a native-language word (or the reverse). 4 options, one correct.", {}, () => ({})),
  multiple_choice: choice("A multiple-choice question about a word, phrase or translation. 4 options, one correct.", {}, () => ({})),
  image_select: choice("Show one emoji that clearly depicts a vocabulary word; options are target-language words. 4 options, one correct.",
    { emoji: s }, (g) => ({ context: g.emoji, big: true })),
  listen_select: choice("The learner hears `audio_text` (a short target-language word or sentence) and picks what they heard or its meaning. Options must not show audio_text verbatim unless the question is 'which did you hear'.",
    { audio_text: s }, (g) => ({ listen: g.audio_text })),
  fill_blank: choice("A target-language sentence with exactly one blank written as ___; options fill the blank.",
    { sentence_with_blank: s }, (g) => ({ context: g.sentence_with_blank })),
  sentence_complete: choice("The beginning of a target-language sentence; options are possible endings, only one natural and correct.",
    { sentence_start: s }, (g) => ({ context: `${g.sentence_start} …` })),
  error_correct: choice("A target-language sentence containing one typical learner mistake; options are rewrites, exactly one fully correct.",
    { wrong_sentence: s }, (g) => ({ context: g.wrong_sentence })),
  dialogue: {
    guide: "A short dialogue (2–4 lines, 'Name: text') following the scenario/goal if given; the learner picks the best next line. 4 options, one correct.",
    schema: z.object({ prompt: s, dialogue_lines: z.array(s).min(2).max(4), options, answer_index: idx }),
    toItem: (g) => g.answer_index >= g.options.length ? null
      : { kind: "choice", prompt: g.prompt, context: g.dialogue_lines.join("\n"), big: false, listen: "", ...shuffleAnswer(g.options, g.answer_index) },
  },
  word_bank: {
    guide: "The learner builds a target-language sentence from word tiles. `answer_words` is the correct sentence split into words (punctuation attached to words), `distractor_words` 2–4 plausible wrong tiles. `prompt` is only the native-language meaning: never write the target sentence in it.",
    schema: z.object({ prompt: s, answer_words: z.array(s).min(2).max(10), distractor_words: z.array(s).min(1).max(4) }),
    toItem: (g) => ({ kind: "bank", prompt: g.prompt, answer: g.answer_words, bank: shuffle([...g.answer_words, ...g.distractor_words]) }),
  },
  translate: {
    guide: "The learner types a translation of `source_sentence` (native → target or target → native). `answer` is the best translation; `accepted_answers` lists other correct variants (may be empty).",
    schema: z.object({ prompt: s, source_sentence: s, answer: s, accepted_answers: z.array(s) }),
    toItem: (g) => ({ kind: "input", prompt: g.prompt, context: g.source_sentence, listen: "", answer: g.answer, accepted: g.accepted_answers }),
  },
  listen_type: {
    guide: "The learner hears `audio_text` (a short target-language sentence) and types it. `accepted_answers` lists acceptable spelling variants (may be empty).",
    schema: z.object({ prompt: s, audio_text: s, accepted_answers: z.array(s) }),
    toItem: (g) => ({ kind: "input", prompt: g.prompt, context: "", listen: g.audio_text, answer: g.audio_text, accepted: g.accepted_answers }),
  },
  match: {
    guide: "4–5 pairs of a target-language word and its native-language translation, all from this step.",
    schema: z.object({ pairs: z.array(z.object({ target: s, native: s })).min(3).max(5) }),
    toItem: (g) => ({ kind: "match", pairs: g.pairs.map((p: any) => [p.target, p.native]) }),
  },
  // speak / story / roleplay / video_call: not generated in v1 (DECISIONS D2, E1) — skipped.
};

export const DEFAULT_COUNT = 2; // DECISIONS B6: used when the YAML activity has no `count`

export type LessonActivity = { key: string; type: string; count: number; hints: Record<string, unknown> };
/** The step's activities that v1 can generate, each keyed a0, a1… for the lesson schema. */
export function plannedActivities(activities: { type: string; count?: number }[]): LessonActivity[] {
  return activities.filter((a) => REGISTRY[a.type]).map(({ type, count, ...hints }, i) => ({ key: `a${i}`, type, count: count ?? DEFAULT_COUNT, hints }));
}

/** One object with a field per activity: strict-mode friendly (no unions) and keeps the YAML order. */
export const lessonSchema = (acts: LessonActivity[]) =>
  z.object(Object.fromEntries(acts.map((a) => [a.key, z.array(REGISTRY[a.type]!.schema).min(1).max(a.count)])));

export function toItems(acts: LessonActivity[], out: Record<string, unknown[]>): Item[] {
  return acts.flatMap((a) => (out[a.key] ?? []).map((g) => REGISTRY[a.type]!.toItem(g)).filter((x): x is Item => !!x));
}

// ---- Prompts ----

export type LessonContext = { course: Course; level: Cefr; levelDef: CourseLevel; unitTitle: string; step: CourseLevel["units"][number]["steps"][number]; native: string };
export const langEn = (iso: string) => new Intl.DisplayNames(["en"], { type: "language" }).of(iso) ?? iso;

export function systemPrompt(c: Pick<LessonContext, "course" | "level" | "native">) {
  return [
    `You write exercises for a language-learning app. The learner is a native ${langEn(c.native)} speaker learning ${c.course.name} at CEFR level ${c.level}.`,
    `Target-language text must be natural and suit ${c.level}. Every instruction ("prompt"), translation, note and explanation is written in ${langEn(c.native)}.`,
    "Practice the step's vocabulary and grammar. Choice questions have exactly one correct option. Do not repeat the same sentence across exercises.",
    "Respond only with JSON matching the schema.",
  ].join("\n");
}

/** One line per past mistake for the prompt (PLAN §3.3); learn/match items carry no single answer. */
export function mistakeLine(it: Item): string | null {
  if (it.kind === "choice") return `${it.prompt} → ${it.options[it.answer]}`;
  if (it.kind === "input") return `${it.prompt} → ${it.answer}`;
  if (it.kind === "bank") return `${it.prompt} → ${it.answer.join(" ")}`;
  if (it.kind === "speak") return `Say aloud → ${it.phrase}`;
  return null;
}

export function lessonPrompt(c: LessonContext, acts: LessonActivity[], mistakes: string[] = [], about: string[] = []) {
  const st = c.step;
  return [
    `Unit: ${c.unitTitle}`, `Step: ${st.title}${st.description ? ` — ${st.description}` : ""}`,
    st.vocabulary.length ? `Vocabulary: ${st.vocabulary.join(", ")}` : "",
    st.grammar.length ? `Grammar patterns: ${st.grammar.map((g) => g.pattern).join(" | ")}` : "",
    "", "Write these exercise groups (field name → exactly N items):",
    ...acts.map((a) => `- ${a.key}: ${a.count} × ${a.type}. ${REGISTRY[a.type]!.guide}${Object.keys(a.hints).length ? ` Hints: ${JSON.stringify(a.hints)}` : ""}`),
    mistakes.length ? `\nThe learner recently got these wrong (exercise → correct answer):\n${mistakes.map((m) => `- ${m}`).join("\n")}\n` +
      "Where it fits this step's topic, reuse 1–2 of these words or patterns in new exercises. Do not copy them, and stay on the step's topic." : "",
    about.length ? `\nAbout the learner: ${about.join(" ")}\nWhere it fits naturally, set a few example sentences in their world (their interests, plans, life). Stay on the step's topic and vocabulary.` : "",
  ].filter((l) => l !== "").join("\n");
}

// ---- Answer checking (DECISIONS C4: normalized string match first, AI only if that fails) ----

export const normalize = (t: string) =>
  t.normalize("NFKC").toLocaleLowerCase().replace(/[’`]/g, "'").replace(/[\p{P}\p{S}]/gu, (ch) => (ch === "'" ? ch : " ")).replace(/\s+/g, " ").trim();

/** Shown instead of a word-tile prompt (also for items cached before this fix). Models sometimes write the tile sentence into the prompt ("'They played…' (Dün…)"): cut it out, keep the meaning. */
export function hideAnswer(prompt: string, answer: string) {
  const words = answer.replace(/[.!?…]+$/, "").trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words[0]) return prompt;
  const rest = prompt.replace(new RegExp(`${words.join("\\s+")}[.!?…]*`, "iu"), "")
    .replace(/(["'“”‘’«»])\s*(["'“”‘’«»])/g, "").trim()
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, "");
  const m = /^\((.*)\)$/s.exec(rest);
  return m ? m[1].trim() : rest;
}

export const matchesAnswer = (given: string, item: { answer: string; accepted: string[] }) =>
  [item.answer, ...item.accepted].some((a) => normalize(a) === normalize(given));

/** Speaking check: share of the expected words the transcript contains (order-free, each word counted once). */
export function speechScore(expected: string, heard: string) {
  const want = normalize(expected).split(" ").filter(Boolean), got = normalize(heard).split(" ");
  let hit = 0;
  for (const w of want) { const k = got.indexOf(w); if (k >= 0) { hit++; got.splice(k, 1); } }
  return want.length ? hit / want.length : 0;
}
export const SPEECH_PASS = 0.75; // ponytail: word overlap, not phoneme scoring; whisper already forgives accents

// ---- Practice built locally from the learner's own words (no AI call) ----

export type PracticeWord = { word: string; translation: string; strength: number };
export const LISTEN_MIN_WORDS = 4;
export const MADNESS_MIN_WORDS = 5;

/** Word Rush: boards of 5 random pairs from the learner's words (words repeat across boards); played against the clock. */
/** Speaking practice: the weakest learned phrases (multi-word first), said aloud. */
export function speakItems(words: PracticeWord[], n = 3): Item[] {
  const multi = (w: PracticeWord) => +(w.word.trim().split(/\s+/).length > 1);
  return [...words].sort((a, b) => multi(b) - multi(a) || a.strength - b.strength).slice(0, n)
    .map((w) => ({ kind: "speak", phrase: w.word, translation: w.translation }));
}

export function madnessItems(words: PracticeWord[], boards = 20): Item[] {
  if (words.length < MADNESS_MIN_WORDS) return [];
  return Array.from({ length: boards }, () => ({
    kind: "match" as const, // ponytail: sort-shuffle, bias is fine for a game
    pairs: [...words].sort(() => Math.random() - 0.5).slice(0, MADNESS_MIN_WORDS).map((w): [string, string] => [w.word, w.translation]),
  }));
}

/** Weakest words first: hear the word, pick it among 3 other known words (from `pool`, by default the same words). */
export function listenItems(words: PracticeWord[], prompt: string, n = 6, pool = words): Item[] {
  if (pool.length < LISTEN_MIN_WORDS) return [];
  const weakest = shuffle(words).sort((a, b) => a.strength - b.strength).slice(0, n);
  return weakest.map((w) => {
    const options = shuffle([w.word, ...shuffle(pool.filter((o) => o.word !== w.word)).slice(0, 3).map((o) => o.word)]);
    return { kind: "choice", prompt, context: "", big: false, listen: w.word, options, answer: options.indexOf(w.word) };
  });
}

/** The question names the correct option and no other ('"evening" means which word?' → evening): nothing left to answer. */
export function givesAway(prompt: string, options: string[], answer: number) {
  const n = (x: string) => normalize(x).replace(/'/g, " ").replace(/\s+/g, " ").trim(); // quotes around the word too
  const p = ` ${n(prompt)} `, has = (o: string) => !!n(o) && p.includes(` ${n(o)} `);
  return has(options[answer]) && !options.some((o, i) => i !== answer && has(o));
}

// ---- helpers ----

export function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}
// Models tend to put the answer first; shuffle so position carries no hint.
export function shuffleAnswer(opts: string[], answer: number) {
  const options = shuffle(opts);
  return { options, answer: options.indexOf(opts[answer]) };
}
