// Fluency drills (epic #31): a mode of the voice Chat.
// Pure: the talk id, planning progression, drill rules/conditions, the avoidance pass prompt and time format. The sheet lives in screens/Screens.tsx, the screen in Talk.tsx.
import { z } from "zod";
import type { Conditions, SessionRow, SpeechSummary } from "./speech.ts";

/** Compared across 4/3/2 rounds; null = not measured (voice analysis off or nothing said). */
export type RoundStat = Pick<SpeechSummary, "wpm" | "pauseRatio" | "fillers"> | null;
/** `round` (1–3) and `prev` (the stats of the rounds before it) only on 4/3/2; `rung` (1–3) only on the ladder; `goal` (a structure) and `named` (a structure avoided in 3 sessions, see `goalToName`) only on the structure drill. */
export type Drill = { kind: "planning" | "432" | "ladder" | "structure"; topic: string; planningSec: number; minutes: number; round?: number; prev?: RoundStat[]; rung?: number; goal?: string; named?: string };
export const FOUR_THREE_TWO_MINUTES = [4, 3, 2];
export const DRILL_MINUTES = 3;
/** Ladder rung 3: a topic the learner did not pick. */
// ponytail: English only, short; the model talks in the course language anyway. Per-language lists if learners ask.
export const NOVEL_TOPICS = [
  "a time you got lost", "the best meal you have ever had", "something you changed your mind about", "a place you would like to live",
  "a skill you would like to learn", "your morning routine", "a small problem you solved recently", "a gift you remember",
];
/** Rung 1: 60 s planning, own topic. Rung 2: no planning, own topic. Rung 3: no planning, a surprise topic. */
export const ladderDrill = (rung: number, topic: string, rand = Math.random): Drill => ({
  kind: "ladder", topic: rung === 3 ? NOVEL_TOPICS[Math.floor(rand() * NOVEL_TOPICS.length)] : topic, planningSec: rung === 1 ? 60 : 0, minutes: DRILL_MINUTES, rung,
});
/** The structure drill: no planning, 3 minutes, steered toward `goal`. */
export const structureDrill = (topic: string, goal: string, named: string | null): Drill =>
  ({ kind: "structure", topic, planningSec: 0, minutes: DRILL_MINUTES, goal, ...(named ? { named } : {}) });
/** Only when the learner avoided `s` in 3 sessions; otherwise nothing is said about avoiding. */
export const NAME_STRUCTURE_PROMPT = (s: string) => `In recent sessions the learner kept steering around "${s}". Early on, name it plainly and invite them to try it in their next answer; if they do, don't make a fuss about it.`;

/** Drill prompts only carry the last few messages; a 3-minute monologue grows the history fast. */
export const DRILL_KEEP = 12;

/** 4/3/2 rounds 2–3: the learner retells the same thing in less time. */
export const REPETITION_RULE = "The learner already told you this once, with more time. Let them tell it again: bring up nothing new, keep your reactions short, so they can say it faster and more smoothly.";

/** Extra system-prompt lines for a drill turn. */
export const drillRules = (d: Drill) => [
  `This is a speaking drill: the learner is telling you about ${d.topic}. React briefly, ask at most one short question, and let the learner do most of the talking.`,
  ...(d.kind === "432" && (d.round ?? 1) > 1 ? [REPETITION_RULE] : []),
  ...(d.goal ? [`Steer the talk toward natural openings where the learner can use "${d.goal}".`] : []),
  ...(d.named ? [NAME_STRUCTURE_PROMPT(d.named)] : []),
];

/** What the speech_sessions row records about the drill. From round 2 on, the 4/3/2 topic is one the learner has already told. */
export const drillConditions = (d: Drill): Conditions => d.kind === "structure"
  ? { mode: "drill", drill: "structure", planningTimeSec: 0, topicFamiliarity: "prepared" }
  : d.kind === "ladder"
  ? { mode: "drill", drill: "ladder", planningTimeSec: d.planningSec, topicFamiliarity: d.rung === 3 ? "novel" : "prepared", rung: d.rung }
  : d.kind === "432"
  ? { mode: "drill", drill: "432", planningTimeSec: 0, topicFamiliarity: (d.round ?? 1) > 1 ? "prepared" : "novel", round: d.round }
  : { mode: "drill", drill: "planning", planningTimeSec: d.planningSec, topicFamiliarity: "prepared" };

export const roundStat = (s: SpeechSummary | null): RoundStat => s && { wpm: s.wpm, pauseRatio: s.pauseRatio, fillers: s.fillers };
const statOf = (x: unknown): RoundStat => {
  const o = (x ?? {}) as Record<string, unknown>;
  return typeof o.wpm === "number" && typeof o.pauseRatio === "number" && typeof o.fillers === "number" ? { wpm: o.wpm, pauseRatio: o.pauseRatio, fillers: o.fillers } : null;
};

const STEPS = [60, 30, 0];
/** Planning seconds for the next session. `past` is newest first. The lowest step reached so far moves down once two sessions were spent on it; it never goes back up. */
export function nextPlanningSec(past: number[]): number {
  if (!past.length) return STEPS[0];
  const cur = Math.min(...past);
  return past.filter((x) => x === cur).length >= 2 ? STEPS[Math.min(STEPS.indexOf(cur) + 1, STEPS.length - 1)] : cur;
}

/** Planning seconds of past planning drills, newest first (`rows` come oldest first). Ladder rung 1 has planning too, but it does not count. */
// ponytail: only sees the rows the caller loaded (Screens loads the last 100 sessions); after 100 other sessions it starts again at 60
export const planningHistory = (rows: SessionRow[]) =>
  rows.filter((r) => r.conditions?.mode === "drill" && r.conditions.drill === "planning").map((r) => r.conditions!.planningTimeSec).reverse();

/** `drill:<who>:<kind>:<uri-encoded JSON>`; `who` is checked by parseTalkId. */
export const drillId = (who: string, d: Drill) => `drill:${who}:${d.kind}:${encodeURIComponent(JSON.stringify(d.kind === "structure"
  ? { topic: d.topic, goal: d.goal, named: d.named }
  : d.kind === "ladder"
  ? { rung: d.rung, topic: d.topic }
  : d.kind === "432"
  ? { topic: d.topic, round: d.round, prev: d.prev ?? [] }
  : { topic: d.topic, planningSec: d.planningSec, minutes: d.minutes }))}`;

/** `rest` = the id after `drill:<who>:`; null when it is not a usable drill. */
export function parseDrill(rest: string[]): Drill | null {
  const [kind, enc] = rest;
  if (rest.length !== 2 || (kind !== "planning" && kind !== "432" && kind !== "ladder" && kind !== "structure")) return null;
  let b: unknown;
  try { b = JSON.parse(decodeURIComponent(enc)); } catch { return null; }
  const { topic, planningSec, minutes, round, prev, rung, goal, named } = (b ?? {}) as Record<string, unknown>;
  if (typeof topic !== "string" || !topic.trim()) return null;
  if (kind === "structure") return typeof goal === "string" && goal.trim() ? structureDrill(topic, goal, typeof named === "string" && named.trim() ? named : null) : null;
  if (kind === "ladder") return rung === 1 || rung === 2 || rung === 3 ? { kind, topic, planningSec: rung === 1 ? 60 : 0, minutes: DRILL_MINUTES, rung } : null;
  if (kind === "432") {
    if (round !== 1 && round !== 2 && round !== 3) return null;
    return { kind, topic, planningSec: 0, minutes: FOUR_THREE_TWO_MINUTES[round - 1], round, prev: (Array.isArray(prev) ? prev : []).slice(0, round - 1).map(statOf) };
  }
  const int = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
  if (!int(planningSec, 0, 60) || !int(minutes, 1, DRILL_MINUTES)) return null;
  return { kind, topic, planningSec, minutes };
}

// ---- Avoidance (#43): did the learner try the drill's goal structure? Voice turns only; typed turns are edited before sending.
export const avoidanceSchema = z.object({ attempted: z.boolean(), evidence: z.string() });
/** A broken reply counts as attempted: nothing is filed on a guess. */
export const looseAvoidance = z.object({ attempted: z.boolean().catch(true), evidence: z.string().catch("") });
export const avoidancePrompt = (target: string, goal: string, learnerTurns: string[]) => [
  `Here are the learner's own spoken turns in ${target} from this session, each on its own line:`,
  ...learnerTurns.map((t) => `- "${t}"`),
  "",
  `The talk aimed at the structure "${goal}". Say whether the learner attempted it: "attempted" is true when the learner used the structure (or clearly came close), false when the talk gave them a real opening and they steered around it. Back it with a verbatim fragment from the turns above as "evidence".`,
  `Answer with ONLY a JSON object: { "attempted": true, "evidence": "…" }.`,
].join("\n");
/** The `avoided` value to save: the goal when the model says it was not attempted, else null. */
export const verifyAvoidance = (goal: string, r: { attempted: boolean }) => r.attempted === false ? goal : null;
/** A goal avoided in ≥3 sessions (each row is one), or null. Rows oldest first, as `listSpeechSessions` returns them; the most recently avoided goal wins. */
export function goalToName(rows: SessionRow[]): string | null {
  const n = new Map<string, number>();
  for (const r of rows) if (r.avoided) n.set(r.avoided, (n.get(r.avoided) ?? 0) + 1);
  for (const r of [...rows].reverse()) if (r.avoided && n.get(r.avoided)! >= 3) return r.avoided;
  return null;
}

export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.max(0, sec) % 60).padStart(2, "0")}`;
