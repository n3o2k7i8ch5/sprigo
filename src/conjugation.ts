// Verb conjugation drills (#30): bundled common verbs + the tenses each level covers; the AI writes the forms twice,
// blind, and only forms both answers agree on are asked. Pure module, tested by src/conjugation.test.ts.
import { z } from "zod";
import { CEFR, type Cefr } from "./course.ts"; // .ts: node --test runs this file directly
import { normalize, type Item } from "./activities.ts";

type Lang = { persons: string[]; verbs: string[]; tenses: Partial<Record<Cefr, string[]>> };
// Tense names in the target language: learners meet them that way, and the model reads them unambiguously.
// `tenses` lists what each level adds; a level drills its own and every earlier one.
export const LANGS: Record<string, Lang> = {
  es: {
    persons: ["yo", "tú", "él/ella", "nosotros", "vosotros", "ellos/ellas"],
    verbs: ["ser", "estar", "tener", "hacer", "ir", "poder", "decir", "querer", "saber", "venir", "hablar", "comer", "vivir",
      "trabajar", "estudiar", "beber", "escribir", "abrir", "dormir", "pedir", "jugar", "pensar", "volver", "salir", "poner"],
    tenses: {
      A1: ["presente"], A2: ["pretérito indefinido", "pretérito imperfecto"],
      B1: ["futuro simple", "pretérito perfecto", "condicional"], B2: ["presente de subjuntivo"], C1: ["imperfecto de subjuntivo"],
    },
  },
  fr: {
    persons: ["je", "tu", "il/elle", "nous", "vous", "ils/elles"],
    verbs: ["être", "avoir", "aller", "faire", "dire", "pouvoir", "vouloir", "savoir", "venir", "prendre", "voir", "parler",
      "manger", "finir", "choisir", "attendre", "vendre", "mettre", "partir", "sortir", "lire", "écrire", "boire", "devoir", "aimer"],
    tenses: {
      A1: ["présent"], A2: ["passé composé", "imparfait"], B1: ["futur simple", "conditionnel présent"],
      B2: ["subjonctif présent", "plus-que-parfait"], C1: ["passé simple"],
    },
  },
  de: {
    persons: ["ich", "du", "er/sie", "wir", "ihr", "sie"],
    verbs: ["sein", "haben", "werden", "können", "müssen", "wollen", "gehen", "kommen", "machen", "sagen", "geben", "nehmen",
      "sehen", "essen", "trinken", "fahren", "lesen", "schreiben", "spielen", "arbeiten", "wohnen", "lernen", "sprechen", "finden", "bleiben"],
    tenses: { A1: ["Präsens"], A2: ["Perfekt", "Präteritum"], B1: ["Futur I"], B2: ["Konjunktiv II"], C1: ["Plusquamperfekt"] },
  },
  tr: {
    persons: ["ben", "sen", "o", "biz", "siz", "onlar"],
    verbs: ["gelmek", "gitmek", "yapmak", "olmak", "etmek", "almak", "vermek", "görmek", "bilmek", "istemek", "yemek", "içmek",
      "okumak", "yazmak", "konuşmak", "çalışmak", "oturmak", "uyumak", "sevmek", "beklemek", "anlamak", "söylemek", "bulmak", "düşünmek", "başlamak"],
    tenses: {
      A1: ["şimdiki zaman (-iyor)"], A2: ["görülen geçmiş zaman (-di)", "gelecek zaman (-ecek)"],
      B1: ["geniş zaman (-ir)", "duyulan geçmiş zaman (-miş)"], B2: ["şart kipi (-se)"], C1: ["gereklilik kipi (-meli)"],
    },
  },
  en: {
    persons: ["I", "you", "he/she", "we", "they"],
    verbs: ["be", "have", "do", "go", "make", "get", "say", "see", "come", "take", "know", "think", "give", "find", "tell",
      "work", "play", "live", "write", "eat", "drink", "speak", "read", "buy", "leave"],
    tenses: {
      A1: ["present simple"], A2: ["past simple", "present continuous"], B1: ["present perfect", "future (will)"],
      B2: ["past perfect", "present perfect continuous"], C1: ["future perfect"],
    },
  },
};

/** Every tense up to and including `level`; empty when the course has no drill. */
export function tensesFor(iso: string, level: Cefr) {
  const l = LANGS[iso];
  return l ? CEFR.slice(0, CEFR.indexOf(level) + 1).flatMap((c) => l.tenses[c] ?? []) : [];
}

export const DRILL_SIZE = 8;
export type Ask = { verb: string; person: string; tense: string };

/** `n` distinct verb + person + tense prompts; newer tenses come up as often as older ones. */
export function pickAsks(iso: string, level: Cefr, n = DRILL_SIZE, rnd = Math.random): Ask[] {
  const l = LANGS[iso], tenses = tensesFor(iso, level), out: Ask[] = [];
  if (!l || !tenses.length) return [];
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  for (let tries = 0; out.length < n && tries < n * 20; tries++) {
    const a = { verb: pick(l.verbs), person: pick(l.persons), tense: pick(tenses) };
    if (!out.some((b) => b.verb === a.verb && b.person === a.person && b.tense === a.tense)) out.push(a);
  }
  return out;
}

export const formsSchema = (n: number) => z.object({ forms: z.array(z.string()).length(n) });

export const formsPrompt = (language: string, asks: Ask[]) => [
  `Conjugate each ${language} verb for the person and tense given. Use standard, widely taught forms.`,
  "`forms` has one entry per line, in order: only the conjugated verb (with its auxiliary in compound tenses), without the subject pronoun.",
  ...asks.map((a, i) => `${i + 1}. ${a.verb} — ${a.person} — ${a.tense}`),
].join("\n");

/** Drill items from two independent answers: a form both agree on is asked; the rest are dropped as unsure.
 *  ponytail: two samples of the same model can agree on the same mistake; bundled tables if reports come in. */
export function crossChecked(asks: Ask[], a: string[], b: string[], prompt: string): Item[] {
  return asks.flatMap((x, i) => {
    const form = a[i]?.trim();
    if (!form || normalize(form) !== normalize(b[i] ?? "")) return [];
    const pronoun = x.person.split("/")[0];
    // Typing the pronoun too is fine; French elides je before a vowel or mute h (j'ai, j'habite).
    const withPronoun = pronoun === "je" && /^[aeiouéèêhâîôûœ]/i.test(form) ? `j'${form}` : `${pronoun} ${form}`;
    return [{ kind: "input" as const, prompt, context: `${x.verb} · ${x.person} · ${x.tense}`, listen: "", answer: form, accepted: [withPronoun],
      cells: [x.verb, x.person, x.tense] as [string, string, string] }];
  });
}
