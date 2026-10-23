import { test } from "node:test";
import assert from "node:assert/strict";
import { filterGrammar, grammarIndex } from "./grammar.ts";
import type { Course } from "./course.ts";

const unit = (id: string, ...steps: string[][]) => ({ id, title: id.toUpperCase(), steps: steps.map((g, i) => ({ id: `${id}-${i}`, grammar: g.map((pattern) => ({ pattern })) })) });
const course = { levels: {
  A2: { title: "Second", units: [unit("c", ["ser + adj", "tener"])] },
  A1: { title: "First", units: [unit("a", ["ser + adj"], ["ser + adj", "estar"]), unit("b", []), unit("d", ["estar"])] },
} } as unknown as Course;

test("grammar index groups level → unit in course order and lists a repeated pattern once", () => {
  const idx = grammarIndex(course);
  assert.deepEqual(idx.map((l) => [l.level, l.title, l.units.map((u) => [u.id, u.patterns.map((e) => e.pattern)])]), [
    ["A1", "First", [["a", ["ser + adj", "estar"]]]], // b has no grammar, d only repeats estar
    ["A2", "Second", [["c", ["tener"]]]],
  ]);
  assert.deepEqual(idx[0].units[0].patterns[0].units.map((u) => [u.id, u.level]), [["a", "A1"], ["c", "A2"]]);
  assert.deepEqual(idx[0].units[0].patterns[1].units.map((u) => u.id), ["a", "d"]);
});

test("grammar search is case-insensitive and drops emptied units and levels", () => {
  const idx = grammarIndex(course);
  assert.deepEqual(filterGrammar(idx, " TEN").map((l) => [l.level, l.units.map((u) => u.patterns.map((e) => e.pattern))]), [["A2", [["tener"]]]]);
  assert.equal(filterGrammar(idx, "  "), idx);
  assert.deepEqual(filterGrammar(idx, "xyz"), []);
});
