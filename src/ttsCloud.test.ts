import { test } from "node:test";
import assert from "node:assert/strict";
import { elevenRequest, ELEVEN_VOICES, localRequest, LOCAL_TTS } from "./ttsCloud.ts";

test("ElevenLabs request: voice in the path, key header, turbo model with the language", () => {
  const r = elevenRequest("k123", ELEVEN_VOICES.f, "Hola", "es-ES");
  assert.equal(r.url, "https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM");
  assert.deepEqual(r.headers, { "xi-api-key": "k123", "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(r.body), { text: "Hola", model_id: "eleven_turbo_v2_5", language_code: "es" });
});

test("local speech server: /v1/audio/speech once, whether or not the address ends in /v1", () => {
  for (const baseURL of ["http://localhost:8880", "http://localhost:8880/", "http://localhost:8880/v1/"]) {
    assert.equal(localRequest({ ...LOCAL_TTS, baseURL }, "Hi").url, "http://localhost:8880/v1/audio/speech");
  }
  const r = localRequest(LOCAL_TTS, "Hi");
  assert.equal(r.headers.Authorization, "Bearer local");
  assert.deepEqual(JSON.parse(r.body), { model: "kokoro", voice: "af_heart", input: "Hi", response_format: "mp3" });
});

test("speed: sent only when not 1; ElevenLabs gets it clamped to 0.7–1.2", () => {
  assert.equal(JSON.parse(localRequest(LOCAL_TTS, "Hi", 0.8).body).speed, 0.8);
  assert.equal("speed" in JSON.parse(localRequest(LOCAL_TTS, "Hi", 1).body), false);
  assert.deepEqual(JSON.parse(elevenRequest("k", "v", "Hola", "es", 0.5).body).voice_settings, { speed: 0.7 });
  assert.equal("voice_settings" in JSON.parse(elevenRequest("k", "v", "Hola", "es").body), false);
});
