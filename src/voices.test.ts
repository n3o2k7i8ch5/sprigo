import { test } from "node:test";
import assert from "node:assert/strict";
import { pickSystemVoice } from "./voices.ts";

const voices = [{ name: "Zarvox", lang: "en-US" }, { name: "Daniel", lang: "en-GB" }, { name: "Samantha", lang: "en_US" }, { name: "Yelda", lang: "tr-TR" }];

test("known names match by gender", () => {
  assert.equal(pickSystemVoice(voices, "en-US", "f").voice?.name, "Samantha");
  assert.equal(pickSystemVoice(voices, "en-US", "m").voice?.name, "Daniel");
  assert.equal(pickSystemVoice(voices, "en", "f").pitch, 1);
});

test("no known name falls back to the first voice with a pitch shift", () => {
  const r = pickSystemVoice(voices, "tr-TR", "m");
  assert.equal(r.voice?.name, "Yelda");
  assert.equal(r.pitch, 0.8);
  assert.equal(pickSystemVoice(voices, "tr", "f").pitch, 1);
  assert.equal(pickSystemVoice(voices, "xx", "f").voice, undefined);
});

test("no gender keeps the default", () => {
  assert.deepEqual(pickSystemVoice(voices, "tr-TR"), { voice: voices[3], pitch: 1 });
});

test("preference order beats install order; full macOS and Windows names match", () => {
  const mac = [{ name: "Fred", lang: "en-US" }, { name: "Eddy (English (US))", lang: "en-US" }, { name: "Daniel (English (UK))", lang: "en-GB" }];
  assert.equal(pickSystemVoice(mac, "en-US", "m").voice?.name, "Daniel (English (UK))");
  assert.equal(pickSystemVoice(mac.slice(0, 2), "en-US", "m").voice?.name, "Eddy (English (US))"); // natural voices before novelty ones
  assert.equal(pickSystemVoice([{ name: "Eddy (German (Germany))", lang: "de-DE" }], "de", "m").voice?.name, "Eddy (German (Germany))");
  const win = [{ name: "Microsoft Zira - English (United States)", lang: "en-US" }, { name: "Microsoft David - English (United States)", lang: "en-US" }];
  assert.equal(pickSystemVoice(win, "en-US", "m").voice?.name, "Microsoft David - English (United States)");
  assert.equal(pickSystemVoice([{ name: "Tomas", lang: "en-US" }], "en-US", "m").pitch, 0.8); // "Tom" is a whole name, not a prefix
});

test("an accent keeps to that region's voices when there are any", () => {
  assert.equal(pickSystemVoice(voices, "en", "f", "en-GB").voice?.name, "Daniel"); // the only en-GB voice
  assert.equal(pickSystemVoice(voices, "en", "f", "en-US").voice?.name, "Samantha"); // en_US counts as en-US
  assert.equal(pickSystemVoice(voices, "en", "f", "en-AU").voice?.name, "Samantha"); // none installed: any English voice
});
