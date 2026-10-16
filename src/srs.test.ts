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
