import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGS, crossChecked, pickAsks, tensesFor } from "./conjugation.ts";

test("a level drills its own tenses and every earlier one", () => {
  assert.deepEqual(tensesFor("es", "A1"), ["presente"]);
  assert.deepEqual(tensesFor("es", "A2"), ["presente", "pretérito indefinido", "pretérito imperfecto"]);
  assert.equal(tensesFor("es", "C2").length, tensesFor("es", "C1").length); // C2 adds nothing new
  assert.deepEqual(tensesFor("xx", "A1"), []);
  for (const iso of ["es", "fr", "de", "tr", "en"]) assert.ok(LANGS[iso].tenses.A1?.length, iso);
});

test("picks are distinct and within the level", () => {
  let n = 0; const rnd = () => (n = (n * 7 + 3) % 11) / 11;
  const asks = pickAsks("fr", "A1", 8, rnd);
  assert.equal(asks.length, 8);
  assert.equal(new Set(asks.map((a) => `${a.verb}|${a.person}|${a.tense}`)).size, 8);
  assert.ok(asks.every((a) => a.tense === "présent"));
});

test("only forms both answers agree on are asked; the pronoun may be typed too", () => {
  const asks = [{ verb: "avoir", person: "je", tense: "présent" }, { verb: "parler", person: "nous", tense: "présent" }, { verb: "être", person: "tu", tense: "présent" }];
  const items = crossChecked(asks, ["ai", " Parlons", "es"], ["ai", "parlons", "est"], "Conjugate");
  assert.deepEqual(items.map((x) => [x.kind === "input" && x.answer, x.kind === "input" && x.accepted]), [["ai", ["j'ai"]], ["Parlons", ["nous Parlons"]]]);
  assert.deepEqual(items[0].kind === "input" && items[0].cells, ["avoir", "je", "présent"]);
});
