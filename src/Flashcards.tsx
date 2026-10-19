// Flashcards (#23): flip a card, grade it with the four FSRS buttons. Reads and writes the same schedule as lessons.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApp } from "./store";
import * as db from "./db";
import { cardQueue, previewDays, type Grade } from "./srs";
import { unitWords } from "./lessons";
import { recordSession, today, xpMult } from "./progress";
import { sfx } from "./Lesson";
import { SpeakButton } from "./SpeakButton";
import { Icon } from "./icons";
import { Done, Shell, useQuit, type Result } from "./Talk";

const GRADES = [[1, "again"], [2, "hard"], [3, "good"], [4, "easy"]] as const;

/** `deck`: "due", "all", or a unit id of the current level (My words from that unit). */
export function Flashcards({ deck }: { deck: string }) {
  const { t } = useTranslation();
  const { course, enrollment, s, setS } = useApp();
  const lang = course?.iso ?? "en";
  const [queue, setQueue] = useState<db.Word[] | null>(null);
  const [p, setP] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [again, setAgain] = useState<Set<string>>(new Set()); // shown once more at the end of the session
  const [result, setResult] = useState<Result | null>(null);
  const { quit, askQuit } = useQuit(!!queue?.length && !result);

  useEffect(() => {
    if (!enrollment || !course) return;
    const unit = course.levels[enrollment.level]?.units.find((u) => u.id === deck);
    const inUnit = unit && new Set(unitWords(unit).map((w) => w.toLowerCase()));
    db.listWords(enrollment.id).then((all) =>
      setQueue(cardQueue(inUnit ? all.filter((w) => inUnit.has(w.word.toLowerCase())) : all, new Date(), deck === "due")));
  }, [enrollment?.id, deck]);

  const card = queue?.[p];
  const days = useMemo(() => card && previewDays(card.card, new Date()), [card]);

  const rate = (g: Grade) => {
    if (!card || !enrollment || !flipped) return;
    db.reviewWord(enrollment.id, card.word, g);
    sfx(g === 1 ? "bad" : "ok");
    const q = g === 1 && !again.has(card.word) ? [...queue!, card] : queue!;
    if (g === 1) setAgain((a) => new Set(a).add(card.word));
    setQueue(q); setFlipped(false);
    if (p + 1 < q.length) return setP(p + 1);
    const n = new Set(q.map((w) => w.word)).size, xp = (5 + n * 2) * xpMult(s), gems = Math.floor(n / 5);
    setS((x) => recordSession(x, { xp, gems, kind: "practice" }, today()));
    sfx("done");
    setResult({ xp, gems });
  };

  // Keyboard: Space/Enter flips, 1–4 grade once flipped. Esc is the Shell's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (result || !card || e.target instanceof HTMLInputElement) return;
      if ((e.key === " " || e.key === "Enter") && !flipped) { e.preventDefault(); setFlipped(true); }
      else if (flipped && /^[1-4]$/.test(e.key)) rate(Number(e.key) as Grade);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  let body: React.ReactNode, footer: React.ReactNode;
  if (!queue) body = <div className="result-wrap"><p className="muted">{t("cards.loading")}</p></div>;
  else if (result) {
    body = <Done title={t("cards.done")} r={result} />;
    footer = <><span /><button className="btn btn-primary" onClick={quit}>{t("lesson.end")}</button></>;
  } else if (!card) {
    body = <div className="result-wrap"><p className="muted">{t(deck === "due" ? "practice.noDue" : "cards.empty")}</p></div>;
    footer = <><span /><button className="btn btn-primary" onClick={quit}>{t("lesson.end")}</button></>;
  } else {
    body = (
      <button className="card flashcard" onClick={() => setFlipped(true)} aria-label={flipped ? undefined : t("cards.flip")}>
        <span lang={lang} className="flashcard-front">{card.word}</span>
        {flipped ? <span className="flashcard-back">{card.translation}</span> : <span className="muted small">{t("cards.flipHint")}</span>}
      </button>
    );
    footer = flipped
      ? <div className="od-grid flashcard-grades" style={{ "--od-cols": 4, "--od-gap": "8px" } as React.CSSProperties}>
        {GRADES.map(([g, k], i) => (
          <button key={g} className={`btn ${g === 1 ? "btn-danger" : g === 3 ? "btn-primary" : "btn-ghost"}`} onClick={() => rate(g)}>
            <span>{g} · {t(`cards.${k}`)}</span><small className="flashcard-days">{t("cards.days", { count: days![i] })}</small>
          </button>
        ))}
      </div>
      : <>
        <SpeakButton className="btn btn-ghost" text={card.word} lang={lang}><Icon name="headphones" /> {t("lesson.listen")}</SpeakButton>
        <button className="btn btn-primary" onClick={() => setFlipped(true)}>{t("cards.flip")}</button>
      </>;
  }
  return <Shell label={t("cards.title")} progress={result ? 100 : queue?.length ? (p / queue.length) * 100 : 0} onClose={askQuit} body={body} footer={footer} />;
}

/** Picks a deck, or adds a card of the learner's own. */
export function CardsSheet({ onAdded }: { onAdded: () => void }) {
  const { t } = useTranslation();
  const { course, enrollment, startLesson, closeSheet, toast } = useApp();
  const [word, setWord] = useState("");
  const [meaning, setMeaning] = useState("");
  const [words, setWords] = useState<db.Word[]>([]);
  const load = () => { if (enrollment) db.listWords(enrollment.id).then(setWords); };
  useEffect(load, [enrollment?.id]);
  const now = new Date();
  const units = (enrollment && course?.levels[enrollment.level]?.units) ?? [];
  const inUnit = (u: (typeof units)[number]) => { const v = new Set(unitWords(u).map((w) => w.toLowerCase())); return words.filter((w) => v.has(w.word.toLowerCase())).length; };
  const decks = [
    { id: "due", label: t("cards.deckDue"), n: cardQueue(words, now, true).length },
    { id: "all", label: t("cards.deckAll"), n: words.length },
    ...units.map((u) => ({ id: u.id, label: u.title, n: inUnit(u) })).filter((d) => d.n),
  ];
  const go = (id: string) => { closeSheet(); startLesson(`cards:${id}`); };
  const add = async () => {
    if (!enrollment || !word.trim() || !meaning.trim()) return;
    await db.addWords(enrollment.id, [[word.trim(), meaning.trim()]]);
    toast(t("cards.added")); setWord(""); setMeaning(""); load(); onAdded();
  };
  return (
    <div className="od-stack" style={{ "--od-gap": "14px", textAlign: "left" } as React.CSSProperties}>
      <h3 style={{ textAlign: "center" }}>{t("cards.title")}</h3>
      <p className="muted small">{t("cards.keys")}</p>
      <div className="od-stack" style={{ "--od-gap": "8px" } as React.CSSProperties}>
        {decks.map((d) => (
          <button key={d.id} className="card row-item" disabled={!d.n} onClick={() => go(d.id)}>
            <span className="od-fill"><b>{d.label}</b></span><span className="muted small">{t("cards.count", { count: d.n })}</span>
          </button>
        ))}
      </div>
      <form className="od-stack" style={{ "--od-gap": "8px" } as React.CSSProperties} onSubmit={(e) => { e.preventDefault(); add(); }}>
        <b>{t("cards.addTitle")}</b>
        <div className="od-row" style={{ "--od-gap": "8px" } as React.CSSProperties}>
          <input className="input od-fill" lang={course?.iso} value={word} onChange={(e) => setWord(e.target.value)} placeholder={t("cards.word")} aria-label={t("cards.word")} />
          <input className="input od-fill" value={meaning} onChange={(e) => setMeaning(e.target.value)} placeholder={t("cards.meaning")} aria-label={t("cards.meaning")} />
        </div>
        <button className="btn btn-ghost btn-block" disabled={!word.trim() || !meaning.trim()}>{t("cards.add")}</button>
      </form>
      <button className="btn btn-ghost btn-block" onClick={closeSheet}>{t("sheet.cancel")}</button>
    </div>
  );
}
