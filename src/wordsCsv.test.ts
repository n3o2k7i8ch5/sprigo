import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWords, toCsv, type CsvWord } from "./wordsCsv.ts";

const reviewed: CsvWord = { word: "Hallo, du", translation: 'say "hi"\nfriendly', card: { due: "2026-02-01 10:00:00", stability: 3.2, difficulty: 5.1, reps: 2, lapses: 1, state: 2, last_review: "2026-01-29 10:00:00" } };
const fresh: CsvWord = { word: "Brot", translation: "bread", card: { due: "2026-01-01 00:00:00", stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 0, last_review: null } };

test("export → import gives the same words and schedules", () => {
  const csv = toCsv([reviewed, fresh]);
  assert.match(csv, /^word,translation,due,stability,difficulty,reps,lapses,state,last_review\r\n/);
  assert.deepEqual(parseWords(csv), { words: [reviewed, fresh], errors: [] });
});

test("two columns without a header import as New cards", () => {
  assert.deepEqual(parseWords("Katze,cat\nHund,dog\n"), { words: [{ word: "Katze", translation: "cat" }, { word: "Hund", translation: "dog" }], errors: [] });
});

test("Anki plain-text export: meta lines, tabs, HTML and sound tags", () => {
  const anki = "#separator:tab\n#html:true\nder Apfel<br>[sound:apfel.mp3]\tthe <b>apple</b> &amp; more\n";
  assert.deepEqual(parseWords(anki).words, [{ word: "der Apfel", translation: "the apple & more" }]);
});

test("malformed rows are reported with their line, the rest still imports", () => {
  const csv = 'word,translation,due,stability,difficulty,reps,lapses,state,last_review\nok,fine,,,,,,,\n,nothing\n"multi\nline",\nonly\nbad,x,tomorrow,1,1,1,0,2,\n';
  const { words, errors } = parseWords(csv);
  assert.deepEqual(words, [{ word: "ok", translation: "fine" }]);
  assert.deepEqual(errors, [{ line: 3, reason: "word" }, { line: 4, reason: "translation" }, { line: 6, reason: "columns" }, { line: 7, reason: "schedule" }]);
});

test("a word listed twice keeps its last row; BOM and semicolons are handled", () => {
  assert.deepEqual(parseWords("﻿eins;one\nzwei;two\neins;1\n").words, [{ word: "zwei", translation: "two" }, { word: "eins", translation: "1" }]);
});
