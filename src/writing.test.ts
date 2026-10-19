import { test } from "node:test";
import assert from "node:assert/strict";
import { looseFeedback, parseWriteId, segments, toMistakes, writeId } from "./writing.ts";

const fix = (original: string, corrected: string) => ({ original, corrected, why: "rule" });

test("segments put each correction where it is, in text order", () => {
  const text = "Yo es Ana. Me gusta el futbol.";
  const out = segments(text, [fix("el futbol", "el fútbol"), fix("Yo es", "Yo soy")]);
  assert.equal(out.map((x) => x.text).join(""), text); // nothing lost or doubled
  assert.deepEqual(out.map((x) => x.fix?.n), [2, undefined, 1, undefined]);
});

test("segments skip corrections not in the text, unchanged or overlapping", () => {
  const text = "Hola amigo.";
  const out = segments(text, [fix("Hola amigo", "¡Hola, amigo"), fix("amigo.", "amiga."), fix("Adiós", "Hasta luego"), fix("Hola", "Hola")]);
  assert.deepEqual(out.map((x) => [x.text, x.fix?.n]), [["Hola amigo", 1], [".", undefined]]);
  assert.deepEqual(segments("", []), []);
});

test("corrections become fix-this items; empty or unchanged ones are dropped", () => {
  const items = toMistakes([fix(" Yo es ", "Yo soy"), fix("bien", "bien"), fix("", "x")], "Correct it");
  assert.deepEqual(items, [{ kind: "input", prompt: "Correct it", context: "Yo es", listen: "", answer: "Yo soy", accepted: [] }]);
});

test("loose feedback keeps the rewrite when the model drops the other fields", () => {
  assert.deepEqual(looseFeedback.parse({ rewritten: "Yo soy Ana." }), { corrections: [], rewritten: "Yo soy Ana.", comment: "" });
});

test("writing ids carry the level", () => {
  assert.deepEqual(parseWriteId(writeId("A2", "jobs")), { level: "A2", unit: "jobs" });
  assert.equal(parseWriteId("write:jobs"), null);
});
