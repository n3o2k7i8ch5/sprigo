// A fake Ollama for the e2e tests: one model, and chat replies built from the JSON schema the app asks for.
// Lesson fields get fixed Spanish values (FIELDS) so a test knows the right answers; anything else gets the
// smallest value the schema accepts.
import type { Page } from "@playwright/test";

/** The correct answer everywhere: choices, typed answers and heard audio are all "hola". */
export const ANSWER = "hola";
export const PAIRS = [["hola", "hello"], ["adiós", "goodbye"], ["gracias", "thank you"]] as const;
export const BANK = ["Buenos", "días"];

const FIELDS: Record<string, unknown> = {
  phrase: "hola", sentence: "Buenos días", translation: "hello", note: "A friendly greeting.",
  prompt: "Which word means “hello”?", options: ["hola", "adiós", "gracias"], answer_index: 0,
  audio_text: "hola", emoji: "👋", sentence_with_blank: "___, amigo.", sentence_start: "Hola,", wrong_sentence: "Hola amigo es.",
  dialogue_lines: ["Ana: ¡Hola!", "Luis: ¿Qué tal?"], source_sentence: "hello", answer: "hola", accepted_answers: [],
  text: "¡Hola, Ana!", answer_words: BANK, distractor_words: ["noches"], pairs: PAIRS.map(([target, native]) => ({ target, native })),
};

const jsonType = (v: unknown) => Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v;

function fill(s: any, key = ""): unknown {
  if (key in FIELDS && jsonType(FIELDS[key]) === s.type) return FIELDS[key]; // `answer` is a string in translate, an index in stories
  if (s.anyOf) return fill(s.anyOf[0], key);
  switch (s.type) {
    case "object": return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, fill(v, k)]));
    case "array": return Array.from({ length: s.minItems ?? 0 }, () => fill(s.items));
    case "string": return s.enum?.[0] ?? "ok";
    case "integer": case "number": return s.minimum ?? 0;
    case "boolean": return false;
    default: return null;
  }
}

const json = (body: unknown) => ({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: JSON.stringify(body) });

export async function mockOllama(page: Page) {
  await page.route("http://localhost:11434/**", async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: {
      "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST" } });
    if (path === "/api/tags") return route.fulfill(json({ models: [{ name: "mock:latest" }] }));
    if (path !== "/v1/chat/completions") return route.fulfill(json({})); // warm-up and the rest
    // ponytail: non-streamed replies only; add SSE when a test covers chat or the tutor call
    const schema = req.postDataJSON().response_format?.json_schema?.schema;
    const content = schema ? JSON.stringify(fill(schema)) : "ok";
    return route.fulfill(json({
      id: "mock", object: "chat.completion", created: 0, model: "mock:latest",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });
}
