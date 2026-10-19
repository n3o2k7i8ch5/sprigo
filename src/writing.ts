// Writing practice (#25): a short composition task per unit, then AI corrections shown inline in the learner's text.
// Pure module, tested by src/writing.test.ts; the AI calls are in src/lessons.ts.
import { z } from "zod";
import type { Item } from "./activities";

/** `write:<level>:<unit>`, like story ids (unit ids repeat across levels). */
export const writeId = (level: string, unit: string) => `write:${level}:${unit}`;
export function parseWriteId(id: string): { level: string; unit: string } | null {
  const m = /^write:([A-C][12]):(.+)$/.exec(id);
  return m ? { level: m[1], unit: m[2] } : null;
}

const s = z.string();
export const taskSchema = z.object({ task: s, hints: z.array(s).max(6) });
export type WritingTask = z.infer<typeof taskSchema>;

export const feedbackSchema = z.object({
  corrections: z.array(z.object({ original: s, corrected: s, why: s })).max(12),
  rewritten: s,
  comment: s,
});
export type Feedback = z.infer<typeof feedbackSchema>;
export const looseFeedback = feedbackSchema.extend({ corrections: feedbackSchema.shape.corrections.catch([]), comment: s.catch("") });

export const taskPrompt = (unitTitle: string, description: string, vocabulary: string[]) => [
  `Write one short writing task for the unit "${unitTitle}"${description ? ` (${description})` : ""}: the learner writes 3–5 sentences.`,
  "`task` is the instruction in the learner's language, concrete and personal (\"Write 4 sentences about…\").",
  `\`hints\`: 3–6 useful target-language words or short phrases, preferably from: ${vocabulary.join(", ")}`,
].join("\n");

export const feedbackPrompt = (task: string, text: string) => [
  `Task: ${task}`,
  `The learner wrote:\n"""\n${text}\n"""`,
  "Correct real mistakes only (grammar, spelling, word choice, unnatural wording); leave correct sentences alone.",
  "`corrections`: one entry per mistake. `original` is copied exactly from the learner's text (a few words around the mistake, never the whole text), " +
    "`corrected` is that part fixed, `why` explains the rule in one short sentence in the learner's language.",
  "`rewritten`: the whole text, corrected and natural, still at the learner's level. `comment`: one encouraging sentence in the learner's language.",
].join("\n");

export type Fix = Feedback["corrections"][number];
export type Segment = { text: string; fix?: Fix & { n: number } };

/** The learner's text cut into plain parts and corrected parts, in order. A correction whose `original` isn't in the
 *  text (the model paraphrased it) or overlaps an earlier one is left out of the text; it still shows in the list. */
export function segments(text: string, fixes: Fix[]): Segment[] {
  const found = fixes.map((f, i) => ({ f, n: i + 1, at: f.original ? text.indexOf(f.original) : -1 }))
    .filter((x) => x.at >= 0 && x.f.original !== x.f.corrected).sort((a, b) => a.at - b.at);
  const out: Segment[] = [];
  let pos = 0;
  for (const { f, n, at } of found) {
    if (at < pos) continue;
    if (at > pos) out.push({ text: text.slice(pos, at) });
    out.push({ text: f.original, fix: { ...f, n } });
    pos = at + f.original.length;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}

/** Each real correction becomes a "fix this" item in the mistakes queue (Practice → Mistakes). */
export const toMistakes = (fixes: Fix[], prompt: string): Item[] => fixes
  .filter((f) => f.original.trim() && f.corrected.trim() && f.original.trim() !== f.corrected.trim())
  .map((f) => ({ kind: "input", prompt, context: f.original.trim(), listen: "", answer: f.corrected.trim(), accepted: [] }));
