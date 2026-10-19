// Writing practice (#25): Practice → Writing → a unit; the learner writes, the AI corrects inline (src/writing.ts).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApp } from "./store";
import { sfx, useStartLesson } from "./Lesson";
import { Done, Failed, Loading, Shell, useQuit, type Result } from "./Talk";
import { MicButton } from "./Mic";
import { Words } from "./Words";
import { Icon } from "./icons";
import * as db from "./db";
import { sttReady } from "./stt";
import { checkWriting, loadWritingTask } from "./lessons";
import { recordSession, today, xpMult } from "./progress";
import { segments, toMistakes, writeId, type Feedback, type WritingTask } from "./writing";
import type { Cefr } from "./course";

const gap = (g: string) => ({ "--od-gap": g }) as React.CSSProperties;

/** Units of the current level, open once started (the first one always), like Stories. */
export function WriteSheet() {
  const { t } = useTranslation();
  const { course, enrollment, done, closeSheet } = useApp();
  const start = useStartLesson();
  const units = (enrollment && course?.levels[enrollment.level]?.units) || [];
  return (
    <div className="od-stack" style={{ ...gap("10px"), textAlign: "left" }}>
      <h3 style={{ textAlign: "center" }}>{t("write.pick")}</h3>
      {units.map((u, ui) => {
        const open = ui === 0 || u.steps.some((st) => done.has(st.id));
        const id = writeId(enrollment!.level, u.id);
        return (
          <button key={u.id} className="card row-item" disabled={!open} onClick={() => { closeSheet(); start(id); }}>
            <Icon name={done.has(id) ? "check" : open ? "pen" : "lock"} />
            <span className="od-field od-fill"><b>{u.title}</b>
              <span className="muted small">{t("learn.kicker", { level: enrollment!.level, unit: ui + 1 })}</span></span>
          </button>
        );
      })}
      <button className="btn btn-ghost btn-block" onClick={closeSheet}>{t("sheet.cancel")}</button>
    </div>
  );
}

export function Writing({ level, unit: unitId }: { level: Cefr; unit: string }) {
  const { t } = useTranslation();
  const { course, enrollment, profile, s, setS, completeStep } = useApp();
  const unit = course?.levels[level]?.units.find((u) => u.id === unitId);
  const lang = course?.iso ?? "en";
  const [gen, setGen] = useState(0);
  const [task, setTask] = useState<WritingTask | null>(null);
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const [fb, setFb] = useState<Feedback | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [stt, setStt] = useState(false);
  const { quit, askQuit } = useQuit(!!text.trim() && !result);
  const base = course && profile && { course, level, native: profile.native_lang };
  useEffect(() => { sttReady().then(setStt); }, []);

  useEffect(() => {
    if (!base || !enrollment || !unit) return;
    let live = true;
    setTask(null); setErr("");
    loadWritingTask(enrollment.id, base, unit, gen > 0).then((x) => live && setTask(x), (e) => live && setErr((e as Error).message));
    return () => { live = false; };
  }, [gen]);

  const check = async () => {
    if (!base || !enrollment || !task || !text.trim()) return;
    setChecking(true); setErr("");
    try {
      const f = await checkWriting(base, task.task, text.trim());
      setFb(f);
      for (const m of toMistakes(f.corrections, t("write.fixPrompt"))) await db.addMistake(enrollment.id, m);
    } catch (e) { setErr((e as Error).message); }
    finally { setChecking(false); }
  };
  const finish = () => {
    const xp = 20 * xpMult(s), gems = 3;
    setS((x) => recordSession(x, { xp, gems, kind: "practice" }, today()));
    completeStep(writeId(level, unitId), xp);
    sfx("done");
    setResult({ xp, gems });
  };

  let body: React.ReactNode, footer: React.ReactNode;
  if (!task) body = err ? <Failed msg={err} retry={() => setGen((g) => g + 1)} quit={quit} /> : <Loading title={unit?.title ?? ""} />;
  else if (result) {
    body = <Done title={t("write.done")} r={result} />;
    footer = <><span /><button className="btn btn-primary" onClick={quit}>{t("lesson.end")}</button></>;
  } else if (fb) {
    const segs = segments(text.trim(), fb.corrections);
    body = <div className="od-stack" style={gap("14px")}>
      <h2 className="ex-title">{t("write.feedback")}</h2>
      <div className="card" lang={lang} style={{ whiteSpace: "pre-wrap", fontSize: 18, lineHeight: 1.6 }}>
        {segs.map((g, i) => g.fix
          ? <span key={i} className="fix"><del>{g.text}</del> <ins>{g.fix.corrected}</ins><sup>{g.fix.n}</sup></span>
          : g.text)}
      </div>
      {fb.corrections.length
        ? <ol className="od-stack" style={{ ...gap("8px"), paddingInlineStart: 22 }}>
          {fb.corrections.map((c, i) => <li key={i}><b lang={lang}>{c.original} → {c.corrected}</b><br /><span className="muted small">{c.why}</span></li>)}
        </ol>
        : <p style={{ color: "var(--green)", fontWeight: 800 }}>{t("write.noCorrections")}</p>}
      <h3 style={{ fontWeight: 900 }}>{t("write.rewritten")}</h3>
      <div className="card" lang={lang} style={{ fontSize: 18 }}><Words text={fb.rewritten} lang={lang} /></div>
      {fb.comment && <p className="muted">{fb.comment}</p>}
    </div>;
    footer = <><span /><button className="btn btn-primary" onClick={finish}>{t("lesson.finish")}</button></>;
  } else {
    body = <div className="od-stack" style={gap("14px")}>
      <h2 className="ex-title">{task.task}</h2>
      {task.hints.length > 0 && <div className="od-cluster" style={gap("8px")} aria-label={t("write.hints")}>
        {task.hints.map((h) => <span key={h} className="word-chip" lang={lang}><Words text={h} lang={lang} /></span>)}
      </div>}
      <textarea className="input" rows={7} value={text} disabled={checking} autoFocus aria-label={t("lesson.yourAnswer")} placeholder={t("write.placeholder")}
        lang={lang} style={{ width: "100%", resize: "vertical", fontSize: 18 }} onChange={(e) => setText(e.target.value)} />
      {stt && s.speakOn && <MicButton lang={lang} disabled={checking}
        onText={(said) => { if (said.trim()) setText((x) => [x.trim(), said.trim()].filter(Boolean).join(" ")); }} />}
    </div>;
    footer = <>
      <span className="small" role={err ? "alert" : undefined} style={{ color: err ? "var(--red)" : undefined, overflowWrap: "anywhere" }}>{err}</span>
      <button className="btn btn-primary" disabled={!text.trim() || checking} onClick={check}>{t(checking ? "lesson.checking" : "lesson.check")}</button>
    </>;
  }
  return <Shell label={unit?.title ?? t("write.title")} progress={result ? 100 : fb ? 66 : text.trim() ? 33 : 0} onClose={askQuit}
    onRegen={task && !fb && !result ? () => setGen((g) => g + 1) : undefined} body={body} footer={footer} />;
}
