# Lesson Quality Eval Implementation Plan (#21)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm eval [model…]` generates a fixed set of step lessons with the app's real prompts on Ollama, checks every exercise with rules (and optionally a judge model), and writes a JSON and a Markdown report per model to `eval/`.

**Architecture:** A pure rule module `src/evalRules.ts` (unit-tested, runs in `pnpm test`) and a runner `scripts/eval.ts` modelled on `scripts/bench.ts`. The runner imports the prompt builders from `src/activities.ts` and calls Ollama's OpenAI-compatible endpoint directly, because `src/ai.ts` and `src/lessons.ts` pull in Tauri and the database.

**Tech Stack:** TypeScript run by Node type stripping (`node file.ts`), zod 4, `node:test`, Ollama `/v1/chat/completions`.

**Spec:** `docs/superpowers/specs/2026-10-16-lesson-eval-design.md`

## Global Constraints

- Developer tool only: nothing under `src/` other than `evalRules.ts` and its test changes, and no app behaviour changes.
- No new dependencies.
- Imports between modules that Node runs directly use the `.ts` extension (`./activities.ts`, `../src/course.ts`); `tsconfig.json` allows this.
- `src/evalRules.ts` stays pure: no Vite, Tauri, `fs` or network imports. `pnpm build` (tsc over `src/`) must pass.
- Reports go to `eval/`, which is gitignored. No report is committed.
- Commit messages: `Area: short sentence (#21)`, ending with the `Co-Authored-By` line the session gives you.
- PR target is the `test` branch, not `master`.
- Work on branch `feat/lesson-eval` (worktree `.worktrees/lesson-eval`). If `node_modules` is missing there, `ln -s ../../node_modules node_modules`.

## Files

- Create `src/evalRules.ts`: language guess, per-item rules, lesson metrics, per-type summary.
- Create `src/evalRules.test.ts`: tests for all of the above.
- Create `scripts/eval.ts`: cases, Ollama calls, fallback, judge, report writing.
- Modify `package.json`: `"eval"` script.
- Modify `.gitignore`: `eval/`.
- Modify `CONTRIBUTING.md`: `pnpm eval` in the setup block plus an "Evaluating lessons" section.

---

### Task 1: Rule module

**Files:**
- Create: `src/evalRules.ts`
- Test: `src/evalRules.test.ts`

**Interfaces:**
- Consumes: `givesAway(prompt: string, options: string[], answer: number): boolean`, `normalize(t: string): string` and `REGISTRY[type].toItem(g): Item | null` from `src/activities.ts`.
- Produces (used by Task 2):
  - `type Lang = "en" | "de" | "es" | "fr" | "tr"`
  - `const RULES = ["answer_in_options", "distinct_options", "no_leak", "target_lang", "native_lang", "one_blank", "dropped"] as const; type Rule`
  - `type Judged = { notes: string; natural: number; level_fit: number; clear: number; one_correct: boolean } | null`
  - `type ItemResult = { type: string; raw: any; failed: Rule[]; judge?: Judged }`
  - `guessLang(text: string): Lang | null`
  - `checkItem(type: string, g: any, ctx: { target: Lang; native: Lang }): Rule[]`: failed rules in `RULES` order
  - `lessonMetrics(vocab: string[], items: { type: string; raw: any }[], native: Lang): { vocab_coverage: number; repeats: number }`
  - `type TypeRow = { type; items; pass; fails: Record<Rule, number>; natural; level_fit; clear; one_correct }` (judge fields `number | null`)
  - `summarize(items: ItemResult[]): TypeRow[]`: one row per type, sorted, then `"total"`

- [ ] **Step 1: Write the failing tests**

Create `src/evalRules.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkItem, guessLang, lessonMetrics, summarize } from "./evalRules.ts";

const EN_TR = { target: "en", native: "tr" } as const;

test("guessLang names each course language and gives up on short or unclear text", () => {
  assert.equal(guessLang("I am fine, thank you."), "en");
  assert.equal(guessLang("Ich bin heute sehr müde."), "de");
  assert.equal(guessLang("Yo estoy muy bien, gracias."), "es");
  assert.equal(guessLang("Je suis très content de te voir."), "fr");
  assert.equal(guessLang("Ben bugün çok yorgunum ama iyiyim."), "tr");
  assert.equal(guessLang("Hello there"), null); // under 3 words
  assert.equal(guessLang("Maria Paulo Tokyo"), null); // no stopword: no winner
});

test("a sound choice item passes every rule", () => {
  const g = { prompt: "'Günaydın' İngilizcede nasıl söylenir?", options: ["Good morning", "Good night", "Goodbye", "Thank you"], answer_index: 0 };
  assert.deepEqual(checkItem("multiple_choice", g, EN_TR), []);
});

test("choice items: answer outside the options, equal options, answer named in the prompt", () => {
  assert.deepEqual(checkItem("multiple_choice", { prompt: "Hangisi?", options: ["Hi", "Bye", "Yes"], answer_index: 3 }, EN_TR), ["answer_in_options", "dropped"]);
  assert.deepEqual(checkItem("multiple_choice", { prompt: "Hangisi?", options: ["Good morning", "good morning!", "Bye", "Hi"], answer_index: 0 }, EN_TR), ["distinct_options"]);
  assert.deepEqual(checkItem("word_select", { prompt: "'evening' kelimesi hangisi?", options: ["evening", "morning", "night", "noon"], answer_index: 0 }, EN_TR), ["no_leak", "dropped"]);
});

test("word_bank: a distractor that is an answer word, the answer sentence in the prompt", () => {
  const g = { prompt: "Ben öğretmenim.", answer_words: ["I", "am", "a", "teacher."], distractor_words: ["is", "an"] };
  assert.deepEqual(checkItem("word_bank", g, EN_TR), []);
  assert.deepEqual(checkItem("word_bank", { ...g, distractor_words: ["teacher", "is"] }, EN_TR), ["distinct_options"]);
  assert.deepEqual(checkItem("word_bank", { ...g, prompt: "I am a teacher. (Ben öğretmenim.)" }, EN_TR), ["no_leak"]);
});

test("translate copies the source; listen_type shows the audio text", () => {
  assert.deepEqual(checkItem("translate", { prompt: "Türkçeye çevir.", source_sentence: "Merhaba", answer: "merhaba!", accepted_answers: [] }, EN_TR), ["no_leak"]);
  assert.deepEqual(checkItem("listen_type", { prompt: "Duyduğunu yaz.", audio_text: "I like coffee", accepted_answers: [] }, EN_TR), []);
  assert.deepEqual(checkItem("listen_type", { prompt: "Duyduğunu yaz: I like coffee", audio_text: "I like coffee", accepted_answers: [] }, EN_TR), ["no_leak"]);
});

test("translate works in both directions", () => {
  const tr = "Ben bir öğretmenim ve çok mutluyum.", en = "I am a teacher and I am very happy.";
  assert.deepEqual(checkItem("translate", { prompt: "İngilizceye çevir.", source_sentence: tr, answer: en, accepted_answers: [] }, EN_TR), []);
  assert.deepEqual(checkItem("translate", { prompt: "Türkçeye çevir.", source_sentence: en, answer: tr, accepted_answers: [] }, EN_TR), []);
});

test("fill_blank needs exactly one blank", () => {
  const g = { prompt: "Boşluğu doldur.", sentence_with_blank: "I ___ a teacher.", options: ["am", "is", "are", "be"], answer_index: 0 };
  assert.deepEqual(checkItem("fill_blank", g, EN_TR), []);
  assert.deepEqual(checkItem("fill_blank", { ...g, sentence_with_blank: "I ___ a ____." }, EN_TR), ["one_blank"]);
});

test("match: a repeated target word", () => {
  const pairs = [{ target: "hi", native: "selam" }, { target: "Hi!", native: "merhaba" }, { target: "bye", native: "hoşça kal" }];
  assert.deepEqual(checkItem("match", { pairs }, EN_TR), ["distinct_options"]);
});

test("target text in another language; native text in the target language", () => {
  assert.deepEqual(checkItem("speak", { sentence: "Je suis très content.", translation: "Çok mutluyum." }, EN_TR), ["target_lang"]);
  assert.deepEqual(checkItem("learn", { phrase: "Good morning", translation: "Günaydın", note: "You say this in the morning to greet someone." }, EN_TR), ["native_lang"]);
});

test("lessonMetrics: vocabulary coverage and repeated sentences", () => {
  const items = [
    { type: "speak", raw: { sentence: "Good morning, how are you?", translation: "Günaydın, nasılsın?" } },
    { type: "listen_type", raw: { prompt: "Duyduğunu yaz.", audio_text: "Good morning, how are you?", accepted_answers: [] } },
    { type: "speak", raw: { sentence: "Thank you very much.", translation: "Çok teşekkürler." } },
  ];
  assert.deepEqual(lessonMetrics(["good morning", "goodbye", "thank you"], items, "tr"), { vocab_coverage: 67, repeats: 1 });
});

test("summarize: a row per type, then the total", () => {
  const rows = summarize([
    { type: "match", raw: {}, failed: [] },
    { type: "match", raw: {}, failed: ["distinct_options"] },
    { type: "speak", raw: {}, failed: [], judge: { notes: "", natural: 4, level_fit: 5, clear: 3, one_correct: true } },
  ]);
  assert.deepEqual(rows.map((r) => [r.type, r.items, r.pass, r.fails.distinct_options, r.natural, r.one_correct]),
    [["match", 2, 50, 1, null, null], ["speak", 1, 100, 0, 4, 100], ["total", 3, 67, 1, 4, 100]]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/evalRules.test.ts`
Expected: FAIL, `Cannot find module '.../src/evalRules.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/evalRules.ts`:

```ts
// Rule checks for `pnpm eval` (#21): what a generated exercise must get right beyond its JSON shape.
// Pure module (no Vite/Tauri imports), tested by src/evalRules.test.ts.
import { givesAway, normalize, REGISTRY } from "./activities.ts";

export const LANGS = ["en", "de", "es", "fr", "tr"] as const;
export type Lang = (typeof LANGS)[number];
export const RULES = ["answer_in_options", "distinct_options", "no_leak", "target_lang", "native_lang", "one_blank", "dropped"] as const;
export type Rule = (typeof RULES)[number];
export type Judged = { notes: string; natural: number; level_fit: number; clear: number; one_correct: boolean } | null;
export type ItemResult = { type: string; raw: any; failed: Rule[]; judge?: Judged };

// ponytail: stopword guess; a language-detection library if it misfires.
const STOP: Record<Lang, Set<string>> = {
  en: new Set("the a an is are was were i you he she it we they to of and in on at for with my your this that do does not have has".split(" ")),
  de: new Set("der die das ein eine ist sind ich du er sie es wir ihr und nicht zu mit von den dem bin hast hat auf für".split(" ")),
  es: new Set("el la los las un una es son yo tú él ella y no de en con por para que mi tu soy estoy está muy".split(" ")),
  fr: new Set("le la les un une est sont je tu il elle nous vous et ne pas de en avec pour que mon ton suis c'est très".split(" ")),
  tr: new Set("bir ve bu şu ben sen o biz siz onlar değil mi mı mu mü ne çok için ile da de var yok".split(" ")),
};
// Letters only one of the five languages uses (ö, ü and ç are shared by German, French and Turkish).
const MARK: Record<Lang, RegExp> = { en: /(?!)/, de: /[ßä]/, es: /[ñáíóú]/, fr: /[èêœàâùû]/, tr: /[ışğ]/ };

/** The likeliest of the five course languages, or null for under 3 words or no clear winner. */
export function guessLang(text: string): Lang | null {
  const words = normalize(text).split(" ").filter(Boolean);
  if (words.length < 3) return null;
  const ranked = LANGS.map((l) => [l, words.filter((w) => STOP[l].has(w) || MARK[l].test(w)).length] as const).sort((a, b) => b[1] - a[1]);
  return ranked[0][1] > ranked[1][1] ? ranked[0][0] : null;
}

const CHOICE = new Set(["word_select", "multiple_choice", "image_select", "listen_select", "fill_blank", "sentence_complete", "error_correct"]);

/** Texts that must be in the course language and in the native language. Options are joined: one word alone is too short to guess. */
export function fieldsOf(type: string, g: any, native: Lang): { target: string[]; native: string[] } {
  const opts = g.options?.join(" ") ?? "";
  switch (type) {
    case "learn": return { target: [g.phrase], native: [g.translation, g.note] };
    case "speak": return { target: [g.sentence], native: [g.translation] };
    case "word_select": case "multiple_choice": return { target: [], native: [g.prompt] }; // direction goes either way
    case "image_select": return { target: [opts], native: [g.prompt] };
    case "listen_select": return { target: [g.audio_text], native: [g.prompt] }; // options may be meanings
    case "fill_blank": return { target: [g.sentence_with_blank, opts], native: [g.prompt] };
    case "sentence_complete": return { target: [g.sentence_start, opts], native: [g.prompt] };
    case "error_correct": return { target: [g.wrong_sentence, opts], native: [g.prompt] };
    case "dialogue": return { target: [...g.dialogue_lines, opts], native: [g.prompt] };
    case "word_bank": return { target: [g.answer_words.join(" ")], native: [g.prompt] };
    case "translate": return { target: [guessLang(g.answer) === native ? g.source_sentence : g.answer], native: [g.prompt] };
    case "listen_type": return { target: [g.audio_text], native: [g.prompt] };
    case "match": return { target: [g.pairs.map((p: any) => p.target).join(" ")], native: [g.pairs.map((p: any) => p.native).join(" ")] };
    default: return { target: [], native: [] };
  }
}

const n = normalize;
const has = (text: string, part: string) => !!n(part) && ` ${n(text)} `.includes(` ${n(part)} `);
const wrongLang = (texts: string[], want: Lang) => texts.some((t) => { const l = guessLang(t); return l !== null && l !== want; });

/** The rules a schema-valid raw item fails, in RULES order. */
export function checkItem(type: string, g: any, ctx: { target: Lang; native: Lang }): Rule[] {
  const bad = new Set<Rule>();
  if (REGISTRY[type]!.toItem(g) === null) bad.add("dropped");
  if (Array.isArray(g.options)) {
    const ok = Number.isInteger(g.answer_index) && g.answer_index >= 0 && g.answer_index < g.options.length;
    if (!ok) bad.add("answer_in_options");
    if (new Set(g.options.map(n)).size !== g.options.length) bad.add("distinct_options");
    if (ok && CHOICE.has(type) && givesAway(g.prompt, g.options, g.answer_index)) bad.add("no_leak");
  }
  if (type === "word_bank") {
    const answer = new Set(g.answer_words.map(n));
    if (g.distractor_words.some((w: string) => answer.has(n(w)))) bad.add("distinct_options");
    if (has(g.prompt, g.answer_words.join(" "))) bad.add("no_leak");
  }
  if (type === "match") {
    const t = g.pairs.map((p: any) => n(p.target)), v = g.pairs.map((p: any) => n(p.native));
    if (new Set(t).size !== t.length || new Set(v).size !== v.length) bad.add("distinct_options");
  }
  if (type === "translate" && n(g.answer) === n(g.source_sentence)) bad.add("no_leak");
  if (type === "listen_type" && has(g.prompt, g.audio_text)) bad.add("no_leak");
  if (type === "fill_blank" && (g.sentence_with_blank.match(/_{3,}/g) ?? []).length !== 1) bad.add("one_blank");
  const f = fieldsOf(type, g, ctx.native);
  if (wrongLang(f.target, ctx.target)) bad.add("target_lang");
  if (wrongLang(f.native, ctx.native)) bad.add("native_lang");
  return RULES.filter((r) => bad.has(r));
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** vocab_coverage: % of the step's vocabulary found anywhere in the lesson; repeats: target sentences (3+ words) used by more than one item. */
export function lessonMetrics(vocab: string[], items: { type: string; raw: any }[], native: Lang) {
  const all = ` ${n(items.map((it) => JSON.stringify(it.raw)).join(" "))} `;
  const seen = new Map<string, number>();
  for (const it of items) {
    const own = new Set(fieldsOf(it.type, it.raw, native).target.map(n).filter((t) => t.split(" ").length >= 3));
    for (const t of own) seen.set(t, (seen.get(t) ?? 0) + 1);
  }
  return { vocab_coverage: pct(vocab.filter((v) => all.includes(` ${n(v)} `)).length, vocab.length), repeats: [...seen.values()].filter((k) => k > 1).length };
}

export type TypeRow = { type: string; items: number; pass: number; fails: Record<Rule, number>;
  natural: number | null; level_fit: number | null; clear: number | null; one_correct: number | null };

/** One row per activity type (sorted), then a "total" row. `pass` and `one_correct` are %, judge scores are 1-decimal averages. */
export function summarize(items: ItemResult[]): TypeRow[] {
  const row = (type: string, xs: ItemResult[]): TypeRow => {
    const j = xs.flatMap((x) => (x.judge ? [x.judge] : []));
    const avg = (f: (v: NonNullable<Judged>) => number) => (j.length ? Math.round((j.reduce((s, v) => s + f(v), 0) / j.length) * 10) / 10 : null);
    return {
      type, items: xs.length, pass: pct(xs.filter((x) => !x.failed.length).length, xs.length),
      fails: Object.fromEntries(RULES.map((r) => [r, xs.filter((x) => x.failed.includes(r)).length])) as Record<Rule, number>,
      natural: avg((v) => v.natural), level_fit: avg((v) => v.level_fit), clear: avg((v) => v.clear),
      one_correct: j.length ? pct(j.filter((v) => v.one_correct).length, j.length) : null,
    };
  };
  const types = [...new Set(items.map((x) => x.type))].sort();
  return [...types.map((t) => row(t, items.filter((x) => x.type === t))), row("total", items)];
}
```

Notes for the implementer:
- `MARK.en` is `/(?!)/`, a regex that never matches: English has no letters of its own.
- `checkItem` only runs on items that already passed the zod schema, so fields exist. It calls `toItem`, which shuffles; the result is only compared with `null`.
- `givesAway` is called only when `answer_index` is valid, because it indexes `options`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/evalRules.test.ts`
Expected: `pass 11`, `fail 0`.

Then: `pnpm test` (all pass) and `pnpm build` (tsc clean).

- [ ] **Step 5: Commit**

```bash
git add src/evalRules.ts src/evalRules.test.ts
git commit -m "Eval: rule checks for generated lessons (#21)"
```

---

### Task 2: Runner, report and docs

**Files:**
- Create: `scripts/eval.ts`
- Modify: `package.json` (scripts block)
- Modify: `.gitignore` (end of file)
- Modify: `CONTRIBUTING.md` (Setup block and a new section after "Workflow")

**Interfaces:**
- Consumes: everything Task 1 produces; from `src/activities.ts`: `REGISTRY`, `langEn`, `lessonPrompt(c, acts)`, `lessonSchema(acts)`, `plannedActivities(activities)`, `systemPrompt(c)`, `type LessonActivity`, `type LessonContext`; from `src/course.ts`: `parseCourse(text, source)`, `levelsOf(course)`.
- Produces: `pnpm eval [model…]`, writing `eval/<YYYY-MM-DD-HHmm>-<model>.json` and `.md` (UTC time, `:` and `/` in the model name replaced by `-`).

The script is not unit-tested, like `scripts/bench.ts`. Its check is a real run against Ollama (Step 4).

- [ ] **Step 1: Write the runner**

Create `scripts/eval.ts`:

```ts
// Lesson quality eval (#21): generates fixed step lessons with the app's real prompts (src/activities.ts) on Ollama,
// checks every exercise (src/evalRules.ts) and, with JUDGE set, has a judge model score it. Reports go to eval/ (gitignored).
// pnpm eval [model…]   (default: every model Ollama lists; JUDGE=<model> adds the judge; OLLAMA=<url>)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { z } from "zod";
import { REGISTRY, langEn, lessonPrompt, lessonSchema, plannedActivities, systemPrompt, type LessonActivity, type LessonContext } from "../src/activities.ts";
import { levelsOf, parseCourse } from "../src/course.ts";
import { checkItem, lessonMetrics, RULES, summarize, type ItemResult, type Judged, type Lang, type TypeRow } from "../src/evalRules.ts";

const BASE = process.env.OLLAMA ?? "http://localhost:11434", JUDGE = process.env.JUDGE;

// Together these cover every type in REGISTRY. Changing the list makes old reports incomparable: note it in the PR.
const CASES: { course: Lang; step: string; native: Lang }[] = [
  { course: "en", step: "basic-greetings", native: "tr" }, // A1: learn, word_select, match, listen_select, speak
  { course: "de", step: "introduce-yourself", native: "tr" }, // A1: translate, fill_blank, word_bank, dialogue
  { course: "es", step: "how-are-you", native: "tr" }, // A1: multiple_choice, word_bank, listen_type, dialogue
  { course: "en", step: "jobs-vocabulary", native: "tr" }, // A2: match, image_select, listen_select
  { course: "en", step: "adverbs-of-frequency", native: "tr" }, // A2: sentence_complete, error_correct, listen_type
  { course: "en", step: "present-perfect-vs-past-simple", native: "tr" }, // B1: fill_blank, error_correct, multiple_choice
  { course: "en", step: "conditional-inversion", native: "tr" }, // C1: fill_blank, word_bank, translate
  { course: "tr", step: "how-old", native: "en" }, // Turkish as the target: word_bank, translate, error_correct
];

/** Normal steps only: the part of stepContext (src/lessons.ts, which imports the database) the cases need. */
function contextOf(k: (typeof CASES)[number]): LessonContext {
  const course = parseCourse(readFileSync(new URL(`../courses/${k.course}.yml`, import.meta.url), "utf8"), `${k.course}.yml`);
  for (const level of levelsOf(course)) {
    const levelDef = course.levels[level]!;
    for (const u of levelDef.units) {
      const step = u.steps.find((s) => s.id === k.step);
      if (step) return { course, level, levelDef, unitTitle: u.title, step, native: k.native };
    }
  }
  throw new Error(`eval case ${k.course}/${k.step}: no such step in courses/${k.course}.yml`);
}
const contexts = CASES.map(contextOf); // a renamed step fails here, before any model call

// Same rule as `reasoning` in src/ai.ts.
const effort = (m: string) => (m.startsWith("glm-5.3-flash") ? "low" : "none");

/** One structured call, sent the way src/ai.ts sends it (json_schema response_format, schema in the prompt too). */
async function chat<S extends z.ZodType>(model: string, schema: S, system: string, prompt: string): Promise<z.infer<S>> {
  const json = z.toJSONSchema(schema);
  const r = await fetch(`${BASE}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(180_000), // like generate()
    body: JSON.stringify({ model, reasoning_effort: effort(model),
      response_format: { type: "json_schema", json_schema: { name: "response", schema: json, strict: true } },
      messages: [{ role: "system", content: `${system}\n\nJSON schema of the reply:\n${JSON.stringify(json)}` }, { role: "user", content: prompt }] }) });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  const text: string = (await r.json()).choices?.[0]?.message?.content ?? "";
  const a = text.indexOf("{"), b = text.lastIndexOf("}"); // like extractJson in src/ai.ts
  if (a < 0 || b < a) throw new Error("no JSON object in the reply");
  return schema.parse(JSON.parse(text.slice(a, b + 1)));
}

type Raw = { key: string; type: string; raw: any };
const take = (a: LessonActivity, list: unknown[] = []): Raw[] => list.map((raw) => ({ key: a.key, type: a.type, raw }));
const short = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);

/** Like generateItems in src/lessons.ts: one call for the whole step, else one call per activity. */
async function generateLesson(model: string, c: LessonContext) {
  const acts = plannedActivities(c.step.activities), system = systemPrompt(c);
  try {
    const out = await chat(model, lessonSchema(acts), system, lessonPrompt(c, acts)) as Record<string, unknown[]>;
    const raws = acts.flatMap((a) => take(a, out[a.key]));
    if (raws.length) return { acts, fallback: false, raws };
  } catch (e) { console.error(`    whole lesson failed (${short(e).slice(0, 80)}), trying per activity`); }
  const raws: Raw[] = [];
  for (const a of acts) {
    const one = { ...a, key: "items" };
    try {
      const out = await chat(model, z.object({ items: z.array(REGISTRY[a.type]!.schema).min(1).max(a.count) }), system, lessonPrompt(c, [one]));
      raws.push(...take(a, out.items));
    } catch (e) { console.error(`    ${a.type} failed: ${short(e).slice(0, 80)}`); }
  }
  return { acts, fallback: true, raws };
}

const judgeSchema = z.object({
  notes: z.string(), // first, so the model reasons before it scores
  natural: z.int().min(1).max(5), level_fit: z.int().min(1).max(5), clear: z.int().min(1).max(5), one_correct: z.boolean(),
});
const judgeSystem = (c: LessonContext) => [
  `You review exercises written for a language-learning app. The learner is a native ${langEn(c.native)} speaker learning ${c.course.name} at CEFR level ${c.level}.`,
  "Score the one exercise you are given. `notes`: one or two sentences on its problems, written before the scores.",
  "`natural` 1–5: the target-language text sounds like a native speaker wrote it.",
  `\`level_fit\` 1–5: its vocabulary and grammar suit ${c.level}.`,
  "`clear` 1–5: the instruction says unambiguously what to do.",
  "`one_correct`: exactly one option or answer is correct (true for exercises without options).",
  "Respond only with JSON matching the schema.",
].join("\n");
const judgeItem = (c: LessonContext, r: Raw): Promise<Judged> =>
  chat(JUDGE!, judgeSchema, judgeSystem(c), `Exercise type: ${r.type}\n${JSON.stringify(r.raw)}`).catch(() => null);

type Case = (typeof CASES)[number] & { level: string } & (
  | { error: string }
  | { fallback: boolean; ms: number; count_ok: boolean; vocab_coverage: number; repeats: number; items: (ItemResult & { key: string })[] });

const git = (args: string) => { try { return execSync(`git ${args}`, { encoding: "utf8" }).trim(); } catch { return ""; } };
const meta = { judge: JUDGE ?? null, date: new Date().toISOString(), commit: git("rev-parse --short HEAD"), dirty: git("status --porcelain") !== "", cases: CASES };

function markdown(model: string, rows: TypeRow[], cases: Case[]) {
  const line = (cells: unknown[]) => `| ${cells.map((x) => x ?? "–").join(" | ")} |`;
  const head = ["type", "items", "pass %", ...RULES, ...(JUDGE ? ["natural", "level fit", "clear", "one correct %"] : [])];
  const caseHead = ["case", "level", "ms", "fallback", "count ok", "vocab %", "repeats"];
  return [
    `# Lesson eval: ${model}`, "",
    `${meta.date} · commit ${meta.commit}${meta.dirty ? " (dirty)" : ""} · judge ${JUDGE ?? "none"}`, "",
    line(head), line(head.map(() => "---")),
    ...rows.map((r) => line([r.type, r.items, r.pass, ...RULES.map((k) => r.fails[k]), ...(JUDGE ? [r.natural, r.level_fit, r.clear, r.one_correct] : [])])),
    "", "## Cases", "", line(caseHead), line(caseHead.map(() => "---")),
    ...cases.map((x) => "error" in x
      ? line([`${x.course}/${x.step}`, x.level, `error: ${x.error.replace(/\|/g, "/")}`, "", "", "", ""])
      : line([`${x.course}/${x.step}`, x.level, x.ms, x.fallback ? "yes" : "", x.count_ok ? "yes" : "no", x.vocab_coverage, x.repeats])),
    "", "## Failures", "",
    ...cases.flatMap((x) => "error" in x ? [] : x.items.filter((it) => it.failed.length)
      .map((it) => `- **${x.course}/${x.step}** ${it.type} [${it.failed.join(", ")}]: \`${JSON.stringify(it.raw)}\``)),
  ].join("\n") + "\n";
}

const models: string[] = process.argv.slice(2).length ? process.argv.slice(2)
  : (await (await fetch(`${BASE}/api/tags`)).json()).models.map((m: { name: string }) => m.name).filter((n: string) => !/embed|ocr/.test(n));
mkdirSync(new URL("../eval/", import.meta.url), { recursive: true });
const stamp = meta.date.slice(0, 16).replace("T", "-").replace(":", ""); // 2026-10-16-1405 (UTC)

for (const model of models) {
  console.error(`\n${model}${JUDGE ? ` (judge ${JUDGE})` : ""}`);
  const cases: Case[] = [];
  for (const [i, k] of CASES.entries()) {
    const c = contexts[i], t0 = performance.now();
    try {
      const { acts, fallback, raws } = await generateLesson(model, c);
      const ms = Math.round(performance.now() - t0);
      if (!raws.length) throw new Error("the model returned no usable exercises");
      const items: (ItemResult & { key: string })[] = [];
      for (const r of raws) {
        const failed = checkItem(r.type, r.raw, { target: k.course, native: k.native });
        items.push(JUDGE ? { ...r, failed, judge: await judgeItem(c, r) } : { ...r, failed });
      }
      const count_ok = acts.every((a) => raws.filter((r) => r.key === a.key).length === a.count);
      cases.push({ ...k, level: c.level, fallback, ms, count_ok, ...lessonMetrics(c.step.vocabulary, raws, k.native), items });
      console.error(`  ${k.course}/${k.step}: ${items.filter((it) => !it.failed.length).length}/${items.length} pass, ${ms} ms${fallback ? ", fallback" : ""}`);
    } catch (e) {
      cases.push({ ...k, level: c.level, error: short(e) });
      console.error(`  ${k.course}/${k.step}: ${short(e).slice(0, 80)}`);
    }
  }
  const rows = summarize(cases.flatMap((x) => ("error" in x ? [] : x.items)));
  const file = new URL(`../eval/${stamp}-${model.replace(/[:/]/g, "-")}`, import.meta.url).pathname;
  writeFileSync(`${file}.json`, JSON.stringify({ meta: { ...meta, model }, cases }, null, 2));
  writeFileSync(`${file}.md`, markdown(model, rows, cases));
  console.table(rows.map(({ fails, ...r }) => ({ ...r, ...fails })));
  console.error(`→ ${file}.md`);
}
```

Notes for the implementer:
- The eight `CASES` together cover all 14 types in `REGISTRY`. The step ids were checked against `courses/*.yml` on 2026-10-16. `contextOf` throws at startup if one disappears.
- The judge uses `effort(JUDGE)` like the generator, so Ollama models answer without thinking.
- `ms` is generation time only; judge calls come after it.

- [ ] **Step 2: Wire it up**

In `package.json`, after the `"bench"` line:

```json
    "bench": "node scripts/bench.ts",
    "eval": "node scripts/eval.ts"
```

At the end of `.gitignore`:

```
# Lesson eval reports (pnpm eval)
eval/
```

- [ ] **Step 3: Document it in CONTRIBUTING.md**

In the Setup code block, after the `pnpm bench` line, add:

```bash
pnpm eval          # lesson quality per Ollama model, report in eval/ (JUDGE=<model> adds a judge)
```

After the "Workflow" section (before "### Conventions"), add:

```markdown
### Evaluating lessons

`pnpm eval [model…]` generates a fixed set of lessons (`CASES` in [`scripts/eval.ts`](scripts/eval.ts): several courses, levels and every exercise type) with the app's real prompts and checks each exercise: the answer is among the options, options are distinct, nothing gives the answer away, text is in the right language, there is exactly one blank. `JUDGE=<model>` also has a strong model (for example an Ollama `:cloud` model) score naturalness, level fit, clarity and whether exactly one answer is correct.

Run it when you change a lesson prompt (`src/activities.ts`), add a course level, or want to recommend a model. Each run writes `eval/<time>-<model>.md` (and `.json` with every exercise). To compare two prompt versions, run it on each branch with the same model and compare the tables; the report header shows the commit. The rule checks themselves are tested in `src/evalRules.test.ts`.
```

- [ ] **Step 4: Run it against Ollama**

Run: `pnpm eval gemma4:e2b-mlx` (or any small model `ollama list` shows; `qwen3:8b` if installed).
Expected: one progress line per case, a `console.table` with one row per type plus `total`, and `→ …/eval/<stamp>-<model>.md`. Open the `.md`: a type table, a Cases table with 8 rows, a Failures list. A run on 2026-10-16 with `gemma4:e2b-mlx` gave 74 items, 49% passing, mostly `native_lang` (prompts written in English instead of Turkish).

Then with the judge (slower: one extra call per exercise): `JUDGE=deepseek-v4-pro:cloud pnpm eval gemma4:e2b-mlx`. Expected: the natural / level fit / clear / one correct % columns filled.

Then: `git status --short` shows no `eval/` files (gitignored), and `pnpm build` and `pnpm test` pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval.ts package.json .gitignore CONTRIBUTING.md
git commit -m "Eval: pnpm eval generates and scores lessons per model (#21)"
```

---

## After the tasks

Push `feat/lesson-eval` and open a PR against `test` that closes #21. Paste one report's type table into the PR description.
