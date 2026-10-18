import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanNotes } from "./releaseNotes.ts";

test("keeps the changes, drops the download note, credits and changelog link", () => {
  const body = "Downloads for macOS, Windows and Linux. The macOS app is not notarized yet.\r\n\r\n## What's Changed\r\n"
    + "* TTS speed and a **slow** replay by @ozerozdas in https://github.com/ozerozdas/sprigo/pull/76\r\n- Word list CSV\r\n\r\n"
    + "**Full Changelog**: https://github.com/ozerozdas/sprigo/compare/v1.6.0...v1.7.0";
  assert.equal(cleanNotes(body), "What's Changed\n• TTS speed and a slow replay\n• Word list CSV");
  assert.equal(cleanNotes("Downloads for macOS, Windows and Linux."), "");
});
