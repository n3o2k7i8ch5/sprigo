import { test } from "node:test";
import assert from "node:assert/strict";
import { dueToday, endOfDay, fromRow, fromSql, isDue, newCard, review, strengthOf, toRow, toSql, type WordCard } from "./srs.ts";

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

test("endOfDay is the last millisecond of the local day", () => {
  const e = endOfDay(new Date(2026, 0, 1, 9, 30));
  assert.deepEqual([e.getFullYear(), e.getMonth(), e.getDate(), e.getHours(), e.getMinutes(), e.getSeconds(), e.getMilliseconds()], [2026, 0, 1, 23, 59, 59, 999]);
});

test("dueToday includes words due later today, puts reviews before New cards, oldest first", () => {
  const now = new Date(2026, 0, 10, 9, 0); // local 09:00
  const at = (h: number, day = 10) => toSql(new Date(2026, 0, day, h, 0));
  const w = (word: string, state: number, due: string) => ({ word, card: { due, stability: state ? 3 : 0, difficulty: state ? 5 : 0, reps: state ? 1 : 0, lapses: 0, state, last_review: state ? at(9, 7) : null } });
  const words = [
    w("newOld", 0, at(8, 9)),
    w("laterToday", 2, at(20)),      // due 20:00 today: counts as due
    w("tomorrow", 2, at(9, 11)),     // not due
    w("overdue", 2, at(8, 8)),
    w("newRecent", 0, at(8)),
    w("relearning", 3, at(7)),
  ];
  assert.deepEqual(dueToday(words, now).map((x) => x.word), ["overdue", "relearning", "laterToday", "newOld", "newRecent"]);
});
