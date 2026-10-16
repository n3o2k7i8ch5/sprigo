# Automatic quality evaluation for AI-generated lessons (#21)

Date: 2026-10-16
Issue: https://github.com/ozerozdas/sprigo/issues/21

## Goal

`pnpm eval [model…]` generates a fixed set of step lessons with the app's real prompts, scores them with rule checks and an optional LLM judge, and writes a JSON and a Markdown report per model. That is enough to tell whether a prompt change, a new model or a new course level made lessons better or worse.

## Decisions

- **Developer tool only.** It lives in `scripts/` like `pnpm bench`, does not ship in the app, and end users never run it. The live filters in the app (`givesAway`, `toItem` drops) stay as they are.
- **Scope:** step lessons only, meaning the activity types in `REGISTRY`. Stories, the guidebook, practice sets and tutor replies are out of scope for v1.
- **Transport:** the script calls Ollama directly over `/v1/chat/completions` (as `scripts/bench.ts` does). The app's `src/ai.ts` imports Tauri and `db.ts` and cannot run under Node. The reasoning effort follows the same rule as `reasoning` in `src/ai.ts`.
- **Real prompts:** the script imports `systemPrompt`, `lessonPrompt`, `lessonSchema`, `plannedActivities`, `REGISTRY` and `toItems` from `src/activities.ts`, and `parseCourse` from `src/course.ts`. What gets measured is what the app sends. Mistakes and learner facts are left empty, so every run sees the same prompt.
- **Judge:** opt-in with `JUDGE=<ollama model>` (for example a `:cloud` model). It uses the same HTTP path, so no API keys are needed. Without `JUDGE` only the rule checks run.
- **Cases:** a fixed `CASES` list in the script, so runs stay comparable when course YAML grows. A `STEPS=` override is not added.
- **CI:** no model in CI and no recorded outputs. The rules are a pure module covered by `pnpm test`. Reports go to the gitignored `eval/` folder, and no reference report is committed.
- **Comparing two prompt versions:** every report records the git commit and whether the tree was dirty. To compare, run `pnpm eval` on each branch and put the two Markdown tables side by side. No diff command.

## Files

- `scripts/eval.ts`: the runner. `package.json` gets `"eval": "node scripts/eval.ts"`.
- `src/evalRules.ts`: pure rule checks, language guess and aggregation.
- `src/evalRules.test.ts`: tests for every rule.
- `.gitignore`: add `eval/`.
- `CONTRIBUTING.md`: an "Evaluating lessons" section.

## Cases

About 7 cases of `{ course, step, native }`:

- `en` at A1, A2, B1, and one of B2/C1, native `tr`
- `de` A1 and `es` A1, native `tr`
- `tr` A1, native `en`, so Turkish is also tested as a target language

The steps are chosen so that, together, they cover every activity type in `REGISTRY`: `learn`, `speak`, `word_select`, `multiple_choice`, `image_select`, `listen_select`, `fill_blank`, `sentence_complete`, `error_correct`, `dialogue`, `word_bank`, `translate`, `listen_type` and `match`. The implementation plan names the exact step ids. The script stops at start with a clear error if a listed step id no longer exists.

The `LessonContext` for a normal step is built in the script (course, level, level definition, unit title, step, native). This copies the few lines of `stepContext` that cover normal steps: `stepContext` lives in `src/lessons.ts`, which imports `db.ts`.

## Run flow

For each model, and for each case:

1. One call for the whole lesson with `systemPrompt(c)` + the JSON schema of `lessonSchema(acts)` as the system message, `lessonPrompt(c, acts)` as the user message, and `response_format: json_schema`. The reply is parsed with the same `{`…`}` extraction as `extractJson` and validated with the zod schema.
2. If parsing or validation fails, fall back to one call per activity, the same way `generateItems` does. The case is marked `fallback: true`.
3. For every raw item, run `REGISTRY[type].toItem` (an item the app would drop counts as `dropped`), then the rule checks.
4. If `JUDGE` is set, send every item to the judge, one call per item.

Models: the CLI arguments. Without any, every model Ollama lists (`/api/tags`, minus embedding and OCR models), as in `bench.ts`. `OLLAMA=` overrides the base URL.

## Rule checks (`evalRules.ts`)

`checkItem(type, raw, ctx)` returns the ids of the rules the raw item fails. `ctx` holds the course language and the native language.

| Rule | Applies to | Fails when |
|---|---|---|
| `answer_in_options` | choice types, `dialogue` | `answer_index` does not point at an option |
| `distinct_options` | choice types, `dialogue` | two options are equal after `normalize` |
| | `word_bank` | a distractor equals an answer word (normalized) |
| | `match` | a target or a native word repeats |
| `no_leak` | choice types | `givesAway(prompt, options, answer_index)` |
| | `word_bank` | the prompt contains the answer sentence (normalized) |
| | `translate` | `answer` equals `source_sentence` (normalized) |
| | `listen_type` | the prompt contains `audio_text` (normalized) |
| `target_lang` | all | a target-language field is guessed as another language |
| `native_lang` | all | `prompt`, a translation or a note is guessed as another language than the native one |
| `one_blank` | `fill_blank` | `sentence_with_blank` does not contain exactly one `___` |
| `dropped` | all | the app's `toItem` returns `null` |

Choice types are `word_select`, `multiple_choice`, `image_select`, `listen_select`, `fill_blank`, `sentence_complete` and `error_correct`.

**Target and native fields per type:** target fields are the options of `image_select`, `listen_select`, `fill_blank`, `sentence_complete`, `error_correct` and `dialogue` (not `word_select` or `multiple_choice`: their direction can go either way, so their options are not language-checked), `audio_text`, `sentence_with_blank`, `sentence_start`, `wrong_sentence`, `dialogue_lines`, the `word_bank` answer, `translate` (`answer` or `source_sentence`: whichever is not guessed as native must be the target language), `phrase` (`learn`), `sentence` (`speak`) and match `target`. Native fields are `prompt`, `translation`, `note` and match `native`.

**Language guess:** `guessLang(text)` counts hits against small stopword lists for en, de, es, fr and tr and returns the best language, or `null` when the text has fewer than 3 words or no clear winner. `null` is never a failure. `// ponytail: stopword guess; a language-detection library if it misfires.`

**Lesson metrics** (per case):

- `vocab_coverage`: the share of the step's vocabulary entries that appear (normalized substring) in the lesson's target fields.
- `repeats`: the number of target sentences that appear in more than one item.
- `count_ok`: every activity returned its requested `count` of items.
- `fallback` and `ms` (wall time).

## Judge

One call per item with a system prompt that names the course, the CEFR level and the native language. The user message is the exercise type plus the raw item as JSON. Schema:

```ts
z.object({
  notes: z.string(),          // first, so the model reasons before it scores
  natural: z.int().min(1).max(5),   // target-language text sounds like a native speaker wrote it
  level_fit: z.int().min(1).max(5), // vocabulary and grammar suit the CEFR level
  clear: z.int().min(1).max(5),     // the instruction says unambiguously what to do
  one_correct: z.boolean(),         // exactly one option or answer is correct (true for types without options)
})
```

A failed or unparseable judge call stores `null` for that item and is left out of the averages.

## Report

Files: `eval/<YYYY-MM-DD-HHmm>-<model>.json` and `.md`, with `:` and `/` in the model name replaced by `-`.

- **JSON:** `meta` (model, judge, date, git short sha, dirty flag, the case list) plus, per case, the raw output, `fallback`, `ms`, the lesson metrics, and per item its type, raw object, failed rules and judge result. Kept so a run can be re-scored later by hand.
- **Markdown:** a header with the meta, then one table row per activity type: items, % passing every rule, a failure count per rule, judge averages (natural, level fit, clear, % one correct). Then a total row, a per-case table of lesson metrics, and a "Failures" list showing each failing item's type, rules and text.
- **Console:** the per-type table via `console.table`, like `bench.ts`.

## Errors

- A case that produces no items, after the fallback too, is recorded with its error, and the run continues.
- An unreachable model or a model that fails every case is recorded in its report with the error, as `bench.ts` does per row.
- Requests use a 180 s timeout, like `generate`.

## Testing

`src/evalRules.test.ts` holds, for every rule, one passing and one failing hand-written item, a `guessLang` case for each of the five languages, a `null` case for a short text, and a `vocab_coverage`/`repeats` check on a small lesson. The script itself is not unit-tested. Like `bench.ts`, it is run by hand against Ollama.

## Done when

- `pnpm eval qwen3:8b` runs against a local Ollama and writes both report files.
- Two reports (two models, or two branches) can be compared from their Markdown tables.
- `pnpm test` covers the rules.
- CONTRIBUTING explains when to run it (prompt changes, a new model, new course levels) and how to compare two reports.
