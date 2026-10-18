import { test } from "node:test";
import assert from "node:assert/strict";
import { NAME_STRUCTURE_PROMPT, NOVEL_TOPICS, structureDrill, avoidancePrompt, goalToName, looseAvoidance, verifyAvoidance, REPETITION_RULE, ladderDrill, drillConditions, drillId, drillRules, mmss, nextPlanningSec, parseDrill, planningHistory, roundStat, type Drill } from "./drills.ts";
import { parseTalkId } from "./characters.ts";
import type { SessionRow } from "./speech.ts";

test("nextPlanningSec: 60 → 30 → 0, two sessions per step, never back up", () => {
  assert.equal(nextPlanningSec([]), 60);
  assert.equal(nextPlanningSec([60]), 60);
  assert.equal(nextPlanningSec([60, 60]), 30);
  assert.equal(nextPlanningSec([30, 60, 60]), 30);
  assert.equal(nextPlanningSec([30, 30, 60, 60]), 0);
  assert.equal(nextPlanningSec([0, 30, 30]), 0);
  assert.equal(nextPlanningSec([60, 30, 30]), 0); // a stray 60 (newest) does not pull it back up
});

const row = (c: SessionRow["conditions"]): SessionRow => ({ utterances: 1, latency_ms: null, wpm: 100, long_pauses: 0, words: 5, native_words: 0, conditions: c });

test("planningHistory: only planning drills, newest first, zeros kept", () => {
  const rows = [ // oldest first, as listSpeechSessions returns them
    row({ mode: "drill", drill: "planning", planningTimeSec: 60, topicFamiliarity: "prepared" }),
    row({ mode: "chat", planningTimeSec: 0, topicFamiliarity: "novel" }),
    row({ mode: "drill", drill: "ladder", planningTimeSec: 60, topicFamiliarity: "prepared", rung: 1 }),
    row(undefined),
    row({ mode: "drill", drill: "planning", planningTimeSec: 0, topicFamiliarity: "prepared" }),
  ];
  assert.deepEqual(planningHistory(rows), [0, 60]);
});

test("drill id round-trips through parseTalkId", () => {
  const d: Drill = { kind: "planning", topic: "my trip: day 1", planningSec: 30, minutes: 3 };
  const t = parseTalkId(drillId("leo", d));
  assert.ok(t);
  assert.equal(t.voice, true);
  assert.equal(t.who, "leo");
  assert.deepEqual(t.drill, d);
  assert.equal(parseTalkId(drillId("nobody", d)), null);
  assert.equal(parseDrill(["planning", "%7Bbad"]), null);
  assert.equal(parseDrill(["planning", encodeURIComponent(JSON.stringify({ topic: " ", planningSec: 30, minutes: 3 }))]), null);
});

test("planning drill ids reject out-of-range or fractional values", () => {
  const p = (planningSec: number, minutes: number) => parseDrill(["planning", encodeURIComponent(JSON.stringify({ topic: "x", planningSec, minutes }))]);
  assert.equal(p(30, 9999), null);
  assert.equal(p(1.5, 3), null);
  assert.equal(p(-1, 3), null);
  assert.equal(p(61, 3), null);
  assert.equal(p(30, 0), null);
  assert.equal(p(30, 2.5), null);
  assert.deepEqual(p(60, 3), { kind: "planning", topic: "x", planningSec: 60, minutes: 3 });
  assert.deepEqual(p(0, 1), { kind: "planning", topic: "x", planningSec: 0, minutes: 1 });
});

test("mmss", () => {
  assert.equal(mmss(0), "0:00");
  assert.equal(mmss(65), "1:05");
  assert.equal(mmss(180), "3:00");
});

const r432 = (round: number, prev: Drill["prev"] = []): Drill => ({ kind: "432", topic: "my weekend", planningSec: 0, minutes: [4, 3, 2][round - 1], round, prev });
const plan: Drill = { kind: "planning", topic: "my weekend", planningSec: 30, minutes: 3 };

test("drillConditions: 4/3/2 rounds and planning", () => {
  assert.deepEqual(drillConditions(r432(1)), { mode: "drill", drill: "432", planningTimeSec: 0, topicFamiliarity: "novel", round: 1 });
  assert.deepEqual(drillConditions(r432(2)), { mode: "drill", drill: "432", planningTimeSec: 0, topicFamiliarity: "prepared", round: 2 });
  assert.deepEqual(drillConditions(r432(3)), { mode: "drill", drill: "432", planningTimeSec: 0, topicFamiliarity: "prepared", round: 3 });
  assert.deepEqual(drillConditions(plan), { mode: "drill", drill: "planning", planningTimeSec: 30, topicFamiliarity: "prepared" });
});

test("drillRules: REPETITION_RULE only in 4/3/2 rounds 2–3", () => {
  assert.ok(!drillRules(r432(1)).includes(REPETITION_RULE));
  assert.ok(drillRules(r432(2)).includes(REPETITION_RULE));
  assert.ok(drillRules(r432(3)).includes(REPETITION_RULE));
  assert.ok(!drillRules(plan).includes(REPETITION_RULE));
  assert.ok(drillRules(plan)[0].includes("my weekend"));
});

test("4/3/2 id carries round and prev; minutes follow the round", () => {
  const prev = [{ wpm: 90, pauseRatio: 0.2, fillers: 3 }, null];
  const t = parseTalkId(drillId("mia", r432(3, prev)));
  assert.ok(t);
  assert.deepEqual(t.drill, r432(3, prev));
  assert.equal(t.drill?.minutes, 2);
  assert.equal(parseDrill(["432", encodeURIComponent(JSON.stringify({ topic: "x", round: 4, prev: [] }))]), null);
  // a broken stat becomes null, and prev never holds more than round - 1 entries
  assert.deepEqual(parseDrill(["432", encodeURIComponent(JSON.stringify({ topic: "x", round: 2, prev: [{ wpm: "fast" }, { wpm: 1, pauseRatio: 0, fillers: 0 }] }))])?.prev, [null]);
});

test("roundStat keeps only the compared numbers", () => {
  assert.equal(roundStat(null), null);
  assert.deepEqual(roundStat({ utterances: 3, silences: 0, latencyMs: null, wpm: 101, pauseRatio: 0.1, longPauses: 1, level: 0.1, fillers: 2, words: 40, nativeWords: 0, speechMs: 20000 }),
    { wpm: 101, pauseRatio: 0.1, fillers: 2 });
});

test("ladderDrill + drillConditions: 3 rungs, each a little harder", () => {
  const [a, b, c] = [1, 2, 3].map((r) => ladderDrill(r, "my job", () => 0));
  assert.deepEqual(a, { kind: "ladder", topic: "my job", planningSec: 60, minutes: 3, rung: 1 });
  assert.deepEqual(b, { kind: "ladder", topic: "my job", planningSec: 0, minutes: 3, rung: 2 });
  assert.deepEqual(c, { kind: "ladder", topic: NOVEL_TOPICS[0], planningSec: 0, minutes: 3, rung: 3 });
  assert.equal(ladderDrill(3, "my job", () => 0.999).topic, NOVEL_TOPICS[NOVEL_TOPICS.length - 1]);
  assert.deepEqual(drillConditions(a), { mode: "drill", drill: "ladder", planningTimeSec: 60, topicFamiliarity: "prepared", rung: 1 });
  assert.deepEqual(drillConditions(b), { mode: "drill", drill: "ladder", planningTimeSec: 0, topicFamiliarity: "prepared", rung: 2 });
  assert.deepEqual(drillConditions(c), { mode: "drill", drill: "ladder", planningTimeSec: 0, topicFamiliarity: "novel", rung: 3 });
});

test("ladder id round-trips; rung 4 is not a drill", () => {
  const d = ladderDrill(1, "my job: the hard part");
  assert.deepEqual(parseTalkId(drillId("tom", d))?.drill, d);
  assert.equal(parseDrill(["ladder", encodeURIComponent(JSON.stringify({ rung: 4, topic: "x" }))]), null);
});

test("verifyAvoidance: only attempted:false files the goal; a broken reply files nothing", () => {
  assert.equal(verifyAvoidance("past simple", { attempted: false }), "past simple");
  assert.equal(verifyAvoidance("past simple", { attempted: true }), null);
  assert.equal(verifyAvoidance("past simple", looseAvoidance.parse({})), null);
  const p = avoidancePrompt("Spanish", "past simple", ["fui al mercado"]);
  assert.ok(p.includes('"past simple"') && p.includes('- "fui al mercado"') && !/repair/i.test(p));
});

test("goalToName: 3 sessions name a goal; the most recently avoided wins", () => {
  const row = (avoided: string | null) => ({ utterances: 1, latency_ms: null, wpm: 100, long_pauses: 0, words: 10, native_words: 0, avoided }) as SessionRow;
  assert.equal(goalToName([row("a"), row(null), row("a")]), null);
  assert.equal(goalToName([row("a"), row("a"), row(null), row("a")]), "a");
  assert.equal(goalToName([row("a"), row("b"), row("a"), row("b"), row("a"), row("b")]), "b");
  assert.equal(goalToName([row("b"), row("b"), row("b"), row("a"), row("a"), row("a")]), "a");
});

test("structure drill: id round-trips, rules steer toward the goal, the named line only when named", () => {
  const d = structureDrill("my weekend", "past simple", null), n = structureDrill("my weekend", "past simple", "going to");
  assert.deepEqual(parseTalkId(drillId("tom", d))?.drill, d);
  assert.deepEqual(parseTalkId(drillId("tom", n))?.drill, n);
  assert.equal(parseDrill(["structure", encodeURIComponent(JSON.stringify({ topic: "x" }))]), null);
  assert.deepEqual(drillConditions(d), { mode: "drill", drill: "structure", planningTimeSec: 0, topicFamiliarity: "prepared" });
  assert.ok(drillRules(d).some((r) => r.includes('"past simple"')));
  assert.ok(!drillRules(d).includes(NAME_STRUCTURE_PROMPT("past simple")));
  assert.ok(drillRules(n).includes(NAME_STRUCTURE_PROMPT("going to")));
});
