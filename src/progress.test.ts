import { test } from "node:test";
import assert from "node:assert/strict";
import { NEW_STATS, lastDays, lastWeeks, recordSession, rollDay, runningTotal, tally } from "./progress.ts";
import type { LeagueState } from "./league.ts";

const lesson = { xp: 30, gems: 4, kind: "lesson" as const };

test("streak grows on consecutive days and resets after a gap", () => {
  let s = recordSession(NEW_STATS, lesson, "2026-03-01");
  assert.equal(s.streak, 1);
  s = recordSession(s, lesson, "2026-03-01");
  assert.equal(s.streak, 1, "same day counts once");
  assert.equal(s.todayXp, 60);
  s = recordSession(s, lesson, "2026-03-02");
  assert.equal(s.streak, 2);
  assert.equal(s.todayXp, 30, "daily XP resets");
  assert.equal(s.bestDayXp, 60);
  assert.equal(rollDay(s, "2026-03-04").streak, 0, "a missed day breaks it");
  assert.equal(recordSession(s, lesson, "2026-03-04").streak, 1);
  assert.equal(s.bestStreak, 2);
});

test("streak freeze covers missed days, across month ends", () => {
  const s = { ...recordSession(NEW_STATS, lesson, "2026-02-27"), streakFreeze: 1 };
  const r = recordSession(s, lesson, "2026-03-01"); // 28 Feb missed
  assert.equal(r.streak, 2);
  assert.equal(r.streakFreeze, 0);
});

test("quests and chest reward", () => {
  let s = recordSession(NEW_STATS, lesson, "2026-03-01");
  s = recordSession(s, lesson, "2026-03-01");
  s = recordSession(s, { xp: 0, gems: 0, kind: "lesson" }, "2026-03-01");
  assert.equal(s.chests, 0);
  s = recordSession(s, { xp: 10, gems: 0, kind: "practice" }, "2026-03-01");
  assert.equal(s.chests, 1);
  s = recordSession(s, { xp: 10, gems: 0, kind: "practice" }, "2026-03-01");
  assert.equal(s.chests, 1, "only once a day");
  assert.equal(rollDay({ ...s, hearts: 0 }, "2026-03-02").hearts, 5);
});

test("rollDay redraws an old-format league the same day and passes the learner on", () => {
  const old = { week: "2026-09-28", tier: 2, rivals: [{ n: "Aylin", c: "#000", rate: 20 }] } as unknown as LeagueState;
  const s = { ...NEW_STATS, day: "2026-10-01", league: old, weekXp: 80 };
  const r = rollDay(s, "2026-10-01", { id: 7, lang: "de" });
  assert.equal(r.league!.tier, 2); assert.equal(r.weekXp, 80);
  assert.deepEqual(r.league!.who, { id: 7, lang: "de" });
  assert.ok(r.league!.rivals.every((x) => x.total > 0));
  assert.equal(rollDay(r, "2026-10-01"), r, "nothing to do: same object");
});

test("XP is logged per day and old days drop off", () => {
  const lesson = { xp: 10, gems: 0, kind: "lesson" as const };
  let s = recordSession({ ...NEW_STATS, xpDays: { "2025-01-01": 99 } }, lesson, "2026-03-01");
  s = recordSession(s, lesson, "2026-03-01");
  s = recordSession(s, lesson, "2026-03-03");
  assert.deepEqual(s.xpDays, { "2026-03-01": 20, "2026-03-03": 10 });
});

test("series helpers: day ranges and running totals", () => {
  const days = lastDays("2026-03-02", 3);
  assert.deepEqual(days, ["2026-02-28", "2026-03-01", "2026-03-02"]);
  assert.deepEqual(runningTotal({ "2026-01-10": 5, "2026-03-01": 2, "2026-03-02": 1 }, days), [5, 7, 8]);
});

test("accuracy tallies per exercise type", () => {
  let a = tally({}, "choice", true);
  a = tally(tally(a, "choice", false), "match", true);
  assert.deepEqual(a, { choice: [1, 2], match: [1, 1] });
});

test("weeks start on Monday, oldest first", () => {
  assert.deepEqual(lastWeeks("2026-10-20", 3), ["2026-10-05", "2026-10-12", "2026-10-19"]); // a Tuesday
  assert.deepEqual(lastWeeks("2026-10-19", 1), ["2026-10-19"]); // a Monday
  assert.deepEqual(lastWeeks("2026-10-25", 1), ["2026-10-19"]); // a Sunday
});
