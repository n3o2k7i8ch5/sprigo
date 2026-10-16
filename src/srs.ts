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

/** End of the learner's local day: "due today" includes words due later today. */
export const endOfDay = (now: Date) => { const d = new Date(now); d.setHours(23, 59, 59, 999); return d; };

/** Words due by the end of today: reviews first (oldest due first), then New cards (oldest first). */
export function dueToday<T extends { card: WordCard }>(words: T[], now: Date): T[] {
  const eod = endOfDay(now), isNew = (w: T) => w.card.state === State.New;
  return words.filter((w) => isDue(w.card, eod))
    .sort((a, b) => +isNew(a) - +isNew(b) || (a.card.due < b.card.due ? -1 : a.card.due > b.card.due ? 1 : 0));
}

// Stability (days until recall drops to 90%) bucketed to the 1–5 bar the word list shows.
// Not retrievability: that reads ~1 right after any review, a wrong answer included.
const BUCKETS = [1, 3, 7, 15];
export const strengthOf = (r: WordCard) =>
  r.state === State.New ? 1 : 1 + BUCKETS.filter((d) => r.stability >= d).length;
