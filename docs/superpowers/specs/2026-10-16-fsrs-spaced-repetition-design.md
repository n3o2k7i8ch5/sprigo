# Spaced repetition with FSRS (#20)

Date: 2026-10-16
Issue: https://github.com/ozerozdas/sprigo/issues/20

## Goal

Every word gets a due date computed by FSRS from how well the learner recalled it. Practice shows how many words are due today and drills them in a dedicated session.

## Decisions

- **What counts as a review:** only per-word recall. That means answers in `practice-listen` and in the new `practice-due` session. Seeing a word (`learn` cards, `match` pairs, saved roleplay phrases) only creates the card in the `New` state. It never grades it.
- **Rating:** wrong → `Again`, right → `Good`. A multiple-choice listen item has no reliable hint or speed signal, so `Hard` and `Easy` are not used yet.
- **Library:** `ts-fsrs` (no dependencies). It is the reference TypeScript implementation, and hand-written FSRS is easy to get subtly wrong.
- **`strength`:** the column stays, because migrations are append-only, but nothing writes it any more. The 0–5 value the UI shows is derived from FSRS retrievability.
- **Lessons:** due words are not mixed into AI lessons in this version.

## Data: migration v5

```sql
ALTER TABLE words ADD COLUMN due TEXT;
ALTER TABLE words ADD COLUMN stability REAL NOT NULL DEFAULT 0;
ALTER TABLE words ADD COLUMN difficulty REAL NOT NULL DEFAULT 0;
ALTER TABLE words ADD COLUMN reps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE words ADD COLUMN lapses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE words ADD COLUMN state INTEGER NOT NULL DEFAULT 0;   -- ts-fsrs State: 0 New, 1 Learning, 2 Review, 3 Relearning
ALTER TABLE words ADD COLUMN last_review TEXT;
```

Then seed the new columns from `strength` in the same step:

| strength | state | stability (days) | difficulty | due | last_review |
|---|---|---|---|---|---|
| 0–1 | 0 New | 0 | 0 | `CURRENT_TIMESTAMP` | NULL |
| 2 | 2 Review | 1 | 5 | `updated_at + 1 day` | `updated_at` |
| 3 | 2 Review | 3 | 5 | `updated_at + 3 days` | `updated_at` |
| 4 | 2 Review | 7 | 5 | `updated_at + 7 days` | `updated_at` |
| 5 | 2 Review | 15 | 5 | `updated_at + 15 days` | `updated_at` |

Seeded `Review` rows get `reps = strength - 1`. Spreading `due` over `updated_at` means existing strong words do not all fall due on the first day. Dates are stored as ISO-8601 strings, the same format `CURRENT_TIMESTAMP` writes. No review log table: add one when #31 (progress charts) needs history.

## Pure module: `src/srs.ts`

A small wrapper around `ts-fsrs` with no DB or React imports, so it runs under `node --test`.

- `type WordCard`: the FSRS columns of a `words` row.
- `fromRow(row) → Card` and `toRow(card) → WordCard`: convert between DB strings and numbers and the `ts-fsrs` `Card`. `Card` fields that are not stored (such as `elapsed_days`, `scheduled_days` and `learning_steps`, depending on the library version) are derived from `last_review`/`due` or set to the library's defaults.
- `review(card, ok, now) → WordCard`: applies `Rating.Again` or `Rating.Good`.
- `isDue(card, now) → boolean`: `due <= now`. `New` cards are always due.
- `strengthOf(card, now) → 0..5`: `New` cards return 1, which matches today's default for a new word. Other cards return `round(retrievability × 5)`, clamped to 0–5.

## DB layer: `src/db.ts`

- `addWords`: inserts new words as `New` cards. For an existing word it only updates `translation` and `updated_at`.
- `nudgeWord` is replaced by `reviewWord(enrollmentId, word, ok)`, which reads the row, applies `srs.review` and writes the FSRS columns.
- `listWords`: selects the FSRS columns as well and fills `strength` with `strengthOf(...)`, so the `Word` type and its callers (word chips, `speakItems`, `listenItems`) keep working unchanged.
- `dueWords(enrollmentId, now)`: rows with `due <= now`, oldest due first, `New` cards included.

## UI

- **Practice screen** (`src/screens/Screens.tsx`): a new **Due review** card above Listen, with the description "N words due today". With 0 due it shows a "nothing due" toast instead of starting.
- **Session** (`src/Lesson.tsx`, id `practice-due`): `listenItems` built from up to 10 due words, with distractors from the whole word list. It needs at least `LISTEN_MIN_WORDS` words in total.
- **Grading:** in `grade`, both `practice-listen` and `practice-due` call `db.reviewWord(..., ok)` for `choice` items with a `listen` word.
- The `practice-listen` ordering stays as it is today: weakest first, using the derived `strength`.
- **i18n:** new keys (`practice.due`, `practice.dueDesc`, `practice.noDue`) added to all 5 locale files.

## Testing

- `src/srs.test.ts`:
  - `review` with `ok = false` gives `Again`: `lapses` grows on a Review card and `due` comes soon.
  - `review` with `ok = true` gives `Good`: `due` moves further out with each review.
  - `strengthOf` returns 1 for `New`, stays within 0–5, and drops as time passes.
  - `fromRow`/`toRow` round-trips.
- Migration test (sql.js, following `migrate.test.ts`): a v4 database with words at strength 0, 2 and 5 migrates to v5 with the states, stabilities and due dates from the table above, and loses no rows.

## Out of scope

Mixing due words into lessons, `Hard`/`Easy` ratings, a review log, due-word notifications, and FSRS parameter tuning (the `ts-fsrs` defaults are used).

## Done when

- Every answer in `practice-listen` and `practice-due` updates that word's FSRS state.
- Practice shows the due count and drills due words.
- Existing databases migrate without losing words.
- `pnpm test` passes, including the new tests.
