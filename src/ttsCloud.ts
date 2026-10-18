// Byte-based TTS engines (cloud and local servers): the HTTP request for one line, nothing else. Pure, tested by src/ttsCloud.test.ts.

export type ByteRequest = { url: string; headers: Record<string, string>; body: string };

// ponytail: two premade multilingual voices (Rachel, Adam); the learner can paste others in Settings.
export const ELEVEN_VOICES: Record<"f" | "m", string> = { f: "21m00Tcm4TlvDq8ikWAM", m: "pNInz6obpgDQGcFmaJgB" };

/** A local OpenAI-compatible speech server (e.g. Kokoro-FastAPI); the voice name is the server's own. */
export type LocalTts = { baseURL: string; model: string; voice: string };
export const LOCAL_TTS: LocalTts = { baseURL: "http://localhost:8880", model: "kokoro", voice: "af_heart" };

/** `POST /v1/audio/speech`, OpenAI's shape; local servers ignore the key, the dummy keeps clients that require one happy. */
export function localRequest(c: LocalTts, text: string, speed = 1): ByteRequest {
  const base = c.baseURL.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
  return {
    url: `${base}/v1/audio/speech`,
    headers: { Authorization: "Bearer local", "Content-Type": "application/json" },
    body: JSON.stringify({ model: c.model, voice: c.voice, input: text, response_format: "mp3", ...(speed !== 1 ? { speed } : {}) }),
  };
}

/** ElevenLabs Turbo v2.5 (it takes an explicit language; without one it guesses from the text). Replies with MP3.
 *  `speed` is clamped to the 0.7–1.2 ElevenLabs accepts. */
export function elevenRequest(key: string, voiceId: string, text: string, lang: string, speed = 1): ByteRequest {
  return {
    url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5", language_code: lang.slice(0, 2).toLowerCase(),
      ...(speed !== 1 ? { voice_settings: { speed: Math.min(1.2, Math.max(0.7, speed)) } } : {}) }),
  };
}
