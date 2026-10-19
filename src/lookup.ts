// Tap a word to see its meaning (#28). The lookup itself is lessonWord in src/lessons.ts.
import { z } from "zod";

export const lookupSchema = z.object({
  lemma: z.string(), translation: z.string(), pos: z.string(), example: z.string(), example_translation: z.string(),
});
export type Lookup = z.infer<typeof lookupSchema>;

/** Text split into words and the bits between them; Intl.Segmenter also handles scripts without spaces (#42). */
export function tokens(text: string, lang: string): { text: string; word: boolean }[] {
  return [...new Intl.Segmenter(lang, { granularity: "word" }).segment(text)].map((s) => ({ text: s.segment, word: !!s.isWordLike }));
}

export const wordKey = (word: string, lang: string) => `word:${word.toLocaleLowerCase(lang)}`;

export type GuideWord = { word: string; translation: string; example: string; example_translation: string };
/** The guidebook entry for `word`, if a cached guide has it (exact match, ignoring case). */
export function fromGuides(guides: { vocabulary: GuideWord[] }[], word: string, lang: string): Lookup | null {
  const w = word.toLocaleLowerCase(lang);
  const g = guides.flatMap((x) => x.vocabulary).find((v) => v.word.toLocaleLowerCase(lang) === w);
  return g ? { lemma: g.word, translation: g.translation, pos: "", example: g.example, example_translation: g.example_translation } : null;
}
