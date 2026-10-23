// Grammar reference (#29): every pattern in the course, grouped level → unit, straight from the YAML.
import { levelsOf, type Cefr, type Course } from "./course.ts";

export type UnitRef = { id: string; title: string; level: Cefr };
export type GrammarEntry = { pattern: string; units: UnitRef[] };
export type GrammarLevel = { level: Cefr; title: string; units: (UnitRef & { patterns: GrammarEntry[] })[] };

/** A pattern repeated in later units is listed once, under its first unit; `units` lists every unit that has it. */
export function grammarIndex(course: Course): GrammarLevel[] {
  const seen = new Map<string, GrammarEntry>();
  const out = levelsOf(course).map((level) => {
    const def = course.levels[level]!;
    return { level, title: def.title, units: def.units.map((u) => {
      const ref = { id: u.id, title: u.title, level };
      const patterns: GrammarEntry[] = [];
      for (const pattern of new Set(u.steps.flatMap((s) => s.grammar.map((g) => g.pattern)))) {
        const e = seen.get(pattern);
        if (e) e.units.push(ref);
        else { const n = { pattern, units: [ref] }; seen.set(pattern, n); patterns.push(n); }
      }
      return { ...ref, patterns };
    }) };
  });
  return out.map((l) => ({ ...l, units: l.units.filter((u) => u.patterns.length) })).filter((l) => l.units.length);
}

/** Search: keeps the entries whose pattern contains `q` (case-insensitive), dropping emptied units and levels. */
export function filterGrammar(index: GrammarLevel[], q: string): GrammarLevel[] {
  const needle = q.trim().toLocaleLowerCase();
  if (!needle) return index;
  return index.map((l) => ({ ...l, units: l.units.map((u) => ({ ...u, patterns: u.patterns.filter((e) => e.pattern.toLocaleLowerCase().includes(needle)) }))
    .filter((u) => u.patterns.length) })).filter((l) => l.units.length);
}
