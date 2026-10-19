import { test } from "node:test";
import assert from "node:assert/strict";
import { fromGuides, tokens, wordKey } from "./lookup.ts";

test("tokens keep every character and mark only words", () => {
  const t = tokens("¿Dónde está el baño?", "es");
  assert.equal(t.map((x) => x.text).join(""), "¿Dónde está el baño?");
  assert.deepEqual(t.filter((x) => x.word).map((x) => x.text), ["Dónde", "está", "el", "baño"]);
  assert.deepEqual(tokens("l'école", "fr").filter((x) => x.word).map((x) => x.text).join("|").includes("école"), true);
});

test("cache key ignores case, per the course's language", () => {
  assert.equal(wordKey("İstanbul", "tr"), wordKey("istanbul", "tr"));
  assert.equal(wordKey("Haus", "de"), "word:haus");
});

test("guidebook entries answer first, ignoring case", () => {
  const g = [{ vocabulary: [{ word: "Haus", translation: "house", example: "Das Haus ist groß.", example_translation: "The house is big." }] }];
  assert.equal(fromGuides(g, "haus", "de")?.translation, "house");
  assert.equal(fromGuides(g, "Hund", "de"), null);
});
