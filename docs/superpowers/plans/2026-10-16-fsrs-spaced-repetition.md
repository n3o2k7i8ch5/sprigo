# FSRS Spaced Repetition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every word in the learner's list gets an FSRS due date. The Listen and the new Due review practice sessions grade words, and Practice shows how many words are due.

**Architecture:** A pure module, `src/srs.ts`, wraps `ts-fsrs` and converts between `words` rows and FSRS cards. Migration v5 adds the FSRS columns to `words` and seeds them from `strength`. `src/db.ts` writes FSRS state. The UI work is a new `practice-due` session and a card on the Practice screen.

**Tech Stack:** TypeScript, React 19, SQLite (tauri-plugin-sql in the app, sql.js in tests), `node --test`, `ts-fsrs` 5.4.2.

Spec: `docs/superpowers/specs/2026-10-16-fsrs-spaced-repetition-design.md`

## Global Constraints

- Only `practice-listen` and `practice-due` answers grade a word. `addWords` (lessons, roleplay) never changes FSRS state of an existing word.
- Rating: wrong → `Rating.Again`, right → `Rating.Good`. No Hard/Easy.
- Scheduler: `fsrs({ enable_short_term: false })`. `learning_steps` is not stored.
- Dates in `words` are SQLite `CURRENT_TIMESTAMP` text, UTC, `"YYYY-MM-DD HH:MM:SS"`.
- `strength` column is no longer written. The displayed 0–5 `strength` comes from `strengthOf`.
- Migrations are append-only: add v5, never edit v1–v4.
- Pure modules (`srs.ts`, `activities.ts`, `migrations.ts`) import nothing from Tauri/React, so `node --test` can load them. Tests import with the `.ts` extension, app code imports without it.
- All 5 locales (`en`, `tr`, `de`, `es`, `fr`) get the new keys. `src/locales.test.ts` checks key parity between en and tr.
- Match the surrounding style: terse comments, `ponytail:` comments for deliberate simplifications.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `package.json`, `pnpm-lock.yaml` | modify | add `ts-fsrs` |
| `src/srs.ts` | create | FSRS wrapper: row ↔ card, review, due check, display strength |
| `src/srs.test.ts` | create | tests for `srs.ts` |
| `src/migrations.ts` | modify | migration v5 |
| `src/migrate.test.ts` | modify | v5 seeding test |
| `src/activities.ts` | modify | `listenItems` takes a distractor `pool` |
| `src/activities.test.ts` | modify | pool test |
| `src/db.ts` | modify | `addWords`, `reviewWord` (replaces `nudgeWord`), `listWords`, `dueWords` |
| `src/Lesson.tsx` | modify | `practice-due` items and grading |
| `src/screens/Screens.tsx` | modify | Due review card |
| `src/locales/*.json` | modify | `practice.due`, `practice.dueDesc`, `practice.noDue` |
| `docs/superpowers/specs/2026-10-16-fsrs-spaced-repetition-design.md` | modify | record the deviations found while planning |

---

### Task 1: `src/srs.ts` FSRS wrapper

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (via pnpm)
- Create: `src/srs.ts`
- Test: `src/srs.test.ts`

**Interfaces:**
- Consumes: `ts-fsrs` (`createEmptyCard`, `fsrs`, `Rating`, `State`, `type Card`)
- Produces:
  - `type WordCard = { due: string; stability: number; difficulty: number; reps: number; lapses: number; state: number; last_review: string | null }`
  - `toSql(d: Date): string`, `fromSql(s: string): Date`
  - `fromRow(r: WordCard): Card`, `toRow(c: Card): WordCard`
  - `newCard(now: Date): WordCard`
  - `review(r: WordCard, ok: boolean, now: Date): WordCard`
  - `isDue(r: WordCard, now: Date): boolean`
  - `strengthOf(r: WordCard): number` (0–5)

- [ ] **Step 1: Add the dependency**

Run: `pnpm add ts-fsrs@^5.4.2`
Expected: `package.json` dependencies gain `"ts-fsrs": "^5.4.2"`.

- [ ] **Step 2: Write the failing tests**

Create `src/srs.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fromRow, fromSql, isDue, newCard, review, strengthOf, toRow, toSql, type WordCard } from "./srs.ts";

const T0 = new Date("2026-01-01T00:00:00Z");
const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);

test("SQLite timestamps round-trip", () => {
  assert.equal(toSql(T0), "2026-01-01 00:00:00");
  assert.equal(fromSql("2026-01-01 00:00:00").getTime(), T0.getTime());
});

test("a new card is due right away and shows strength 1", () => {
  const c = newCard(T0);
  assert.equal(c.state, 0);
  assert.equal(c.reps, 0);
  assert.equal(c.last_review, null);
  assert.ok(isDue(c, T0));
  assert.equal(strengthOf(c), 1);
});

test("fromRow/toRow round-trips the stored columns", () => {
  const row: WordCard = { due: "2026-01-08 00:00:00", stability: 7, difficulty: 5, reps: 3, lapses: 1, state: 2, last_review: "2026-01-01 00:00:00" };
  assert.deepEqual(toRow(fromRow(row)), row);
});

test("right answers push the due date further out each time", () => {
  let c = review(newCard(T0), true, T0);
  const first = fromSql(c.due).getTime() - T0.getTime();
  assert.ok(first >= 86_400_000, "first Good is at least a day away (no short-term steps)");
  assert.equal(c.reps, 1);
  assert.ok(!isDue(c, T0));
  const at = fromSql(c.due);
  c = review(c, true, at);
  assert.ok(fromSql(c.due).getTime() - at.getTime() > first, "second interval is longer");
  assert.equal(c.reps, 2);
});

test("a wrong answer on a review card counts a lapse, lowers stability and comes back soon", () => {
  const known: WordCard = { due: toSql(days(15)), stability: 15, difficulty: 5, reps: 4, lapses: 0, state: 2, last_review: toSql(T0) };
  const c = review(known, false, days(15));
  assert.equal(c.lapses, 1);
  assert.ok(c.stability < known.stability);
  assert.ok(fromSql(c.due).getTime() - days(15).getTime() <= 2 * 86_400_000);
  assert.ok(strengthOf(c) < strengthOf(known));
});

test("strength buckets follow stability: <1d 1, 1–3d 2, 3–7d 3, 7–15d 4, 15d+ 5", () => {
  const at = (stability: number): WordCard => ({ due: toSql(T0), stability, difficulty: 5, reps: 1, lapses: 0, state: 2, last_review: toSql(T0) });
  assert.deepEqual([0.5, 1, 2.9, 3, 7, 14.9, 15, 400].map((s) => strengthOf(at(s))), [1, 2, 2, 3, 4, 4, 5, 5]);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test src/srs.test.ts`
Expected: FAIL, `Cannot find module '.../src/srs.ts'`.

- [ ] **Step 4: Write `src/srs.ts`**

```ts
// Spaced repetition (#20): FSRS state per word, scheduled by ts-fsrs. Pure module, tested by src/srs.test.ts.
// Only per-word recall grades a card (listen, due review); seeing a word in a lesson just creates it.
import { createEmptyCard, fsrs, Rating, State, type Card } from "ts-fsrs";

/** The FSRS columns of a `words` row. Dates are SQLite CURRENT_TIMESTAMP text: UTC "YYYY-MM-DD HH:MM:SS". */
export type WordCard = { due: string; stability: number; difficulty: number; reps: number; lapses: number; state: number; last_review: string | null };

// ponytail: no same-day learning steps, so `learning_steps` needs no column. Store it if short-term steps are wanted.
const scheduler = fsrs({ enable_short_term: false });
const DAY = 86_400_000;

export const toSql = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
export const fromSql = (s: string) => new Date(s.replace(" ", "T") + "Z");

export function fromRow(r: WordCard): Card {
  const due = fromSql(r.due), last = r.last_review ? fromSql(r.last_review) : undefined;
  return {
    ...createEmptyCard(due),
    stability: r.stability, difficulty: r.difficulty, reps: r.reps, lapses: r.lapses, state: r.state as State, last_review: last,
    scheduled_days: last ? Math.max(0, Math.round((due.getTime() - last.getTime()) / DAY)) : 0,
  };
}

export function toRow(c: Card): WordCard {
  return { due: toSql(c.due), stability: c.stability, difficulty: c.difficulty, reps: c.reps, lapses: c.lapses, state: c.state, last_review: c.last_review ? toSql(c.last_review) : null };
}

export const newCard = (now: Date) => toRow(createEmptyCard(now));

export const review = (r: WordCard, ok: boolean, now: Date) =>
  toRow(scheduler.next(fromRow(r), now, ok ? Rating.Good : Rating.Again).card);

export const isDue = (r: WordCard, now: Date) => r.state === State.New || fromSql(r.due) <= now;

// Stability (days until recall drops to 90%) bucketed to the 0–5 bar the word list shows.
// Not retrievability: that reads ~1 right after any review, a wrong answer included.
const BUCKETS = [1, 3, 7, 15];
export const strengthOf = (r: WordCard) =>
  r.state === State.New ? 1 : 1 + BUCKETS.filter((d) => r.stability >= d).length;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test src/srs.test.ts`
Expected: PASS, 6 tests.

If "first Good is at least a day away" fails, check that `enable_short_term: false` is passed. If the lapse test's "comes back soon" bound fails, print `c.due` and widen the bound to the observed interval only if it is still ≤ 3 days.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/srs.ts src/srs.test.ts
git commit -m "SRS: FSRS wrapper for word cards (#20)"
```

---

### Task 2: Migration v5 seeds FSRS state from `strength`

**Files:**
- Modify: `src/migrations.ts` (append after the `v: 4` entry, before the closing `];`)
- Test: `src/migrate.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (pure SQL). Column names must match `WordCard`: `due`, `stability`, `difficulty`, `reps`, `lapses`, `state`, `last_review`.
- Produces: `words` table with those columns. Every row has a non-null `due`.

- [ ] **Step 1: Write the failing test**

Append to `src/migrate.test.ts`:

```ts
test("v5 seeds FSRS state from word strength and keeps every word", async () => {
  const db = fresh();
  await runMigrations(db, MIGRATIONS.filter((m) => m.v <= 4));
  await db.execute("INSERT INTO profiles(id, name, color, ui_lang, native_lang, stats) VALUES (1, 'a', 'green', 'en', 'en', '{}')");
  await db.execute("INSERT INTO enrollments(id, profile_id, course_iso, level) VALUES (1, 1, 'es', 'A1')");
  for (const [w, s] of [["uno", 0], ["dos", 2], ["tres", 3], ["cuatro", 4], ["cinco", 5]] as const)
    await db.execute("INSERT INTO words(enrollment_id, word, translation, strength, updated_at) VALUES (1, $1, 'x', $2, '2026-01-01 00:00:00')", [w, s]);
  await runMigrations(db, MIGRATIONS);
  const rows = await db.select<Record<string, unknown>>("SELECT word, state, stability, difficulty, reps, lapses, due, last_review FROM words ORDER BY strength");
  assert.equal(rows.length, 5);
  const { due: newDue, ...fresh0 } = rows[0];
  assert.deepEqual(fresh0, { word: "uno", state: 0, stability: 0, difficulty: 0, reps: 0, lapses: 0, last_review: null });
  assert.match(String(newDue), /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  const seeded = (word: string, stability: number, reps: number, due: string) =>
    ({ word, state: 2, stability, difficulty: 5, reps, lapses: 0, due, last_review: "2026-01-01 00:00:00" });
  assert.deepEqual(rows.slice(1), [
    seeded("dos", 1, 1, "2026-01-02 00:00:00"),
    seeded("tres", 3, 2, "2026-01-04 00:00:00"),
    seeded("cuatro", 7, 3, "2026-01-08 00:00:00"),
    seeded("cinco", 15, 4, "2026-01-16 00:00:00"),
  ]);
});
```

Also add nothing to `TABLES`: v5 adds columns, not tables.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/migrate.test.ts`
Expected: the new test FAILS with `no such column: state` (or similar). The other tests still pass.

- [ ] **Step 3: Add migration v5**

In `src/migrations.ts`, append after the `v: 4` object:

```ts
  {
    v: 5, // #20: FSRS state per word (src/srs.ts), seeded from the old 0–5 strength so progress carries over.
    // `due` has no default: ALTER TABLE only takes constant defaults, so addWords writes it. `strength` stays, unused.
    sql: `ALTER TABLE words ADD COLUMN due TEXT;
ALTER TABLE words ADD COLUMN stability REAL NOT NULL DEFAULT 0;
ALTER TABLE words ADD COLUMN difficulty REAL NOT NULL DEFAULT 0;
ALTER TABLE words ADD COLUMN reps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE words ADD COLUMN lapses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE words ADD COLUMN state INTEGER NOT NULL DEFAULT 0;
ALTER TABLE words ADD COLUMN last_review TEXT;
UPDATE words SET
  state = CASE WHEN strength >= 2 THEN 2 ELSE 0 END,
  stability = CASE WHEN strength >= 5 THEN 15 WHEN strength = 4 THEN 7 WHEN strength = 3 THEN 3 WHEN strength = 2 THEN 1 ELSE 0 END,
  difficulty = CASE WHEN strength >= 2 THEN 5 ELSE 0 END,
  reps = CASE WHEN strength >= 2 THEN MIN(strength, 5) - 1 ELSE 0 END,
  last_review = CASE WHEN strength >= 2 THEN updated_at END,
  due = CASE WHEN strength >= 5 THEN datetime(updated_at, '+15 days') WHEN strength = 4 THEN datetime(updated_at, '+7 days')
    WHEN strength = 3 THEN datetime(updated_at, '+3 days') WHEN strength = 2 THEN datetime(updated_at, '+1 day') ELSE CURRENT_TIMESTAMP END`,
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/migrate.test.ts`
Expected: PASS, all tests including the new one.

- [ ] **Step 5: Commit**

```bash
git add src/migrations.ts src/migrate.test.ts
git commit -m "DB: migration v5, FSRS columns on words seeded from strength (#20)"
```

---

### Task 3: `listenItems` takes a distractor pool

**Files:**
- Modify: `src/activities.ts` (`listenItems`, around line 185)
- Test: `src/activities.test.ts`

**Interfaces:**
- Consumes: `PracticeWord` (unchanged: `{ word; translation; strength }`)
- Produces: `listenItems(words: PracticeWord[], prompt: string, n = 6, pool: PracticeWord[] = words): Item[]`. Questions come from `words`, wrong options come from `pool`. Returns `[]` when `pool.length < LISTEN_MIN_WORDS`.

- [ ] **Step 1: Write the failing test**

Append to `src/activities.test.ts`:

```ts
test("listening practice can ask a few words and draw wrong options from a larger pool", async () => {
  const { listenItems } = await import("./activities.ts");
  const pool = ["a", "b", "c", "d", "e"].map((w, i) => ({ word: w, translation: w.toUpperCase(), strength: i }));
  const items = listenItems([pool[4]], "?", 10, pool);
  assert.equal(items.length, 1);
  const it = items[0];
  assert.ok(it.kind === "choice");
  assert.equal(it.listen, "e");
  assert.equal(new Set(it.options).size, 4);
  assert.equal(it.options[it.answer], "e");
  assert.deepEqual(listenItems([], "?", 10, pool), []);
  assert.deepEqual(listenItems([pool[0]], "?", 10, pool.slice(0, 3)), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/activities.test.ts`
Expected: the new test FAILS. `listenItems([pool[4]], ...)` returns `[]` because one word is below `LISTEN_MIN_WORDS`.

- [ ] **Step 3: Change `listenItems`**

Replace the current function in `src/activities.ts`:

```ts
/** Weakest words first: hear the word, pick it among 3 other known words (from `pool`, by default the same words). */
export function listenItems(words: PracticeWord[], prompt: string, n = 6, pool = words): Item[] {
  if (pool.length < LISTEN_MIN_WORDS) return [];
  const weakest = shuffle(words).sort((a, b) => a.strength - b.strength).slice(0, n);
  return weakest.map((w) => {
    const options = shuffle([w.word, ...shuffle(pool.filter((o) => o.word !== w.word)).slice(0, 3).map((o) => o.word)]);
    return { kind: "choice", prompt, context: "", big: false, listen: w.word, options, answer: options.indexOf(w.word) };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/activities.test.ts`
Expected: PASS, including the existing "listening practice picks the weakest words" test.

- [ ] **Step 5: Commit**

```bash
git add src/activities.ts src/activities.test.ts
git commit -m "Practice: listenItems draws wrong options from a pool (#20)"
```

---

### Task 4: DB layer writes and reads FSRS state

**Files:**
- Modify: `src/db.ts:188-201` (the `Word` type, `addWords`, `nudgeWord`, `listWords`)
- Modify: `src/Lesson.tsx:185` (the only `nudgeWord` caller, so the build keeps compiling)

**Interfaces:**
- Consumes: from `./srs`: `isDue`, `newCard`, `review`, `strengthOf`, `type WordCard`
- Produces:
  - `type Word = { word: string; translation: string; strength: number; card: WordCard }`
  - `addWords(enrollmentId: number, pairs: [string, string][]): Promise<void>` (signature unchanged)
  - `reviewWord(enrollmentId: number, word: string, ok: boolean): Promise<void>` (replaces `nudgeWord`)
  - `listWords(enrollmentId: number): Promise<Word[]>`
  - `dueWords(enrollmentId: number): Promise<Word[]>`

`db.ts` imports Tauri and can't run under `node --test`. The FSRS logic it calls is covered by Task 1. This task is verified with `tsc` and the full test suite.

- [ ] **Step 1: Replace the words section in `src/db.ts`**

Add to the imports at the top:

```ts
import { isDue, newCard, review, strengthOf, type WordCard } from "./srs";
```

Replace lines 188–201 (`export type Word …` through `listWords`) with:

```ts
export type Word = { word: string; translation: string; strength: number; card: WordCard };
const CARD_COLS = "due, stability, difficulty, reps, lapses, state, last_review";
/** New words start as FSRS New cards. Seeing a word again only refreshes its translation: only recall is graded (#20). */
export async function addWords(enrollmentId: number, pairs: [string, string][]) {
  const d = await db(), c = newCard(new Date());
  for (const [w, t] of pairs) await d.execute(
    `INSERT INTO words(enrollment_id, word, translation, ${CARD_COLS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT DO UPDATE SET translation = $3, updated_at = CURRENT_TIMESTAMP`,
    [enrollmentId, w, t, c.due, c.stability, c.difficulty, c.reps, c.lapses, c.state, c.last_review]);
}
/** One recall of `word`: right → Good, wrong → Again (src/srs.ts). */
export async function reviewWord(enrollmentId: number, word: string, ok: boolean) {
  const d = await db();
  const [row] = await d.select<WordCard>(`SELECT ${CARD_COLS} FROM words WHERE enrollment_id = $1 AND word = $2`, [enrollmentId, word]);
  if (!row) return;
  const c = review(row, ok, new Date());
  await d.execute(
    "UPDATE words SET due = $1, stability = $2, difficulty = $3, reps = $4, lapses = $5, state = $6, last_review = $7, updated_at = CURRENT_TIMESTAMP WHERE enrollment_id = $8 AND word = $9",
    [c.due, c.stability, c.difficulty, c.reps, c.lapses, c.state, c.last_review, enrollmentId, word]);
}
export async function listWords(enrollmentId: number): Promise<Word[]> {
  const rows = await (await db()).select<{ word: string; translation: string } & WordCard>(
    `SELECT word, translation, ${CARD_COLS} FROM words WHERE enrollment_id = $1 ORDER BY updated_at DESC, word`, [enrollmentId]);
  return rows.map(({ word, translation, ...card }) => ({ word, translation, strength: strengthOf(card), card }));
}
// ponytail: filters the whole list in JS; a `due` index and a WHERE when word lists reach the thousands.
export async function dueWords(enrollmentId: number) {
  const now = new Date();
  return (await listWords(enrollmentId)).filter((w) => isDue(w.card, now));
}
```

- [ ] **Step 2: Switch the one caller of `nudgeWord`**

In `src/Lesson.tsx`, line 185, replace:

```ts
      if (id === "practice-listen" && it.kind === "choice") db.nudgeWord(enrollment.id, it.listen, ok ? 1 : -1);
```

with:

```ts
      if ((id === "practice-listen" || id === "practice-due") && it.kind === "choice") db.reviewWord(enrollment.id, it.listen, ok);
```

- [ ] **Step 3: Type-check and run all tests**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. If `grep -rn nudgeWord src` finds anything, switch it to `reviewWord` the same way.

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/db.ts src/Lesson.tsx
git commit -m "DB: words keep FSRS state; listen answers review the word (#20)"
```

---

### Task 5: Due review session and Practice card

**Files:**
- Modify: `src/Lesson.tsx:56-64` (`practiceItems`)
- Modify: `src/screens/Screens.tsx:85-121` (`Practice`)
- Modify: `src/locales/en.json`, `tr.json`, `de.json`, `es.json`, `fr.json` (the `practice` block)
- Modify: `docs/superpowers/specs/2026-10-16-fsrs-spaced-repetition-design.md`

**Interfaces:**
- Consumes: `db.dueWords`, `db.listWords`, `Word.card` (Task 4); `listenItems(words, prompt, n, pool)` (Task 3); `isDue` (Task 1)
- Produces: lesson id `practice-due`; i18n keys `practice.due`, `practice.dueDesc` (plural, `{{count}}`), `practice.noDue`

- [ ] **Step 1: Build `practice-due` items**

In `src/Lesson.tsx` `practiceItems`, add after the `practice-listen` line:

```ts
  if (id === "practice-due") {
    const [due, all] = await Promise.all([db.dueWords(enrollmentId), db.listWords(enrollmentId)]);
    return listenItems(due, listenPrompt, 10, all);
  }
```

Grading already handles `practice-due` (Task 4, Step 2).

- [ ] **Step 2: Add the Due review card**

In `src/screens/Screens.tsx`, add the import:

```ts
import { isDue } from "../srs";
```

In `Practice()`, after `const { mistakes, words, timed } = data;` add:

```ts
  const now = new Date(), due = words.filter((w) => isDue(w.card, now)).length;
```

Then insert this card directly above the Listen card (the line with `start("practice-listen")`):

```tsx
        {card(() => !due ? toast(t("practice.noDue")) : words.length >= LISTEN_MIN_WORDS ? start("practice-due") : toast(t("practice.needWords", { count: LISTEN_MIN_WORDS })),
          "refresh", "var(--green-tint)", "var(--green)", t("practice.due"), due ? t("practice.dueDesc", { count: due }) : t("practice.noDue"))}
```

- [ ] **Step 3: Add the strings**

Add these keys inside the `"practice"` object of each locale file, right after its `"listenPrompt"` line:

`src/locales/en.json`:
```json
    "due": "Due review",
    "dueDesc_one": "{{count}} word due today",
    "dueDesc_other": "{{count}} words due today",
    "noDue": "No words due — come back tomorrow",
```

`src/locales/tr.json`:
```json
    "due": "Günün tekrarı",
    "dueDesc": "Bugün {{count}} kelime tekrar bekliyor",
    "noDue": "Tekrar bekleyen kelime yok — yarın gel",
```

`src/locales/de.json`:
```json
    "due": "Fällige Wiederholung",
    "dueDesc_one": "{{count}} Wort ist heute fällig",
    "dueDesc_other": "{{count}} Wörter sind heute fällig",
    "noDue": "Keine Wörter fällig – komm morgen wieder",
```

`src/locales/es.json`:
```json
    "due": "Repaso del día",
    "dueDesc_one": "{{count}} palabra para repasar hoy",
    "dueDesc_many": "{{count}} palabras para repasar hoy",
    "dueDesc_other": "{{count}} palabras para repasar hoy",
    "noDue": "No hay palabras para repasar — vuelve mañana",
```

`src/locales/fr.json`:
```json
    "due": "Révision du jour",
    "dueDesc_one": "{{count}} mot à réviser aujourd'hui",
    "dueDesc_other": "{{count}} mots à réviser aujourd'hui",
    "dueDesc_many": "{{count}} mots à réviser aujourd'hui",
    "noDue": "Aucun mot à réviser — reviens demain",
```

- [ ] **Step 4: Type-check and run all tests**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass, including `locales.test.ts` (en/tr key parity, no pre-garden wording).

- [ ] **Step 5: Check it in the browser preview**

Run the Vite dev server (`pnpm dev`, which uses sql.js in the browser) through the preview tool. Then:
1. Open Practice. With no words, the Due review card shows "No words due — come back tomorrow".
2. Finish one lesson so words are added. Due review shows "N words due today" (new words are due right away).
3. Start Due review and answer: one right, one wrong. Close it. The due count drops by the number answered.
4. In "My words", the right-answered word shows a longer strength bar than the wrong-answered one, which shows 1/5. A first Good gives stability of about 2–3 days, so the right-answered word shows 2 or 3.
5. Check the console for errors.

- [ ] **Step 6: Record the planning deviations in the spec**

In `docs/superpowers/specs/2026-10-16-fsrs-spaced-repetition-design.md`:
- Under **Decisions**, add: "**Scheduler:** `fsrs({ enable_short_term: false })`: no same-day learning steps, so `learning_steps` is not stored."
- In **Pure module**, replace the `strengthOf` bullet with: "`strengthOf(card) → 1..5`: `New` → 1. Otherwise stability bucketed: <1d → 1, 1–3d → 2, 3–7d → 3, 7–15d → 4, ≥15d → 5. Retrievability was rejected because it reads ~1 right after any review, a wrong answer included."
- In **Data**, replace "Dates are stored as ISO-8601 strings, the same format `CURRENT_TIMESTAMP` writes" with "Dates are stored as SQLite `CURRENT_TIMESTAMP` text (UTC, `YYYY-MM-DD HH:MM:SS`)".
- In **DB layer**, replace the `dueWords` bullet with: "`dueWords(enrollmentId)`: `listWords` filtered by `isDue`. The session orders them weakest first, like Listen."
- In **Testing**, replace "drops as time passes" with "follows the stability buckets".

- [ ] **Step 7: Commit**

```bash
git add src/Lesson.tsx src/screens/Screens.tsx src/locales/*.json docs/superpowers/specs/2026-10-16-fsrs-spaced-repetition-design.md
git commit -m "Practice: Due review session and due-today count (#20)"
```

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| FSRS columns + seed from strength | 2 |
| `srs.ts` wrapper, rating map, `isDue`, `strengthOf` | 1 |
| `addWords` exposure-only, `reviewWord`, `listWords`, `dueWords` | 4 |
| Listen answers update FSRS | 4 |
| Due review session + Practice count | 5 |
| i18n in 5 locales | 5 |
| Tests: srs + migration | 1, 2 |
| Existing DBs migrate without losing words | 2 (row count assert) |
