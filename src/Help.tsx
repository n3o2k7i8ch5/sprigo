import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useApp } from "./store";
import { isTauri } from "./db";
import { Icon } from "./icons";

/** In-app help (#39): the top setup questions, offline and in every UI language. The wiki keeps the long guides. */
export type HelpTopic = "ai" | "aiConnect" | "weak" | "mic" | "voice" | "phone" | "data" | "offline";

const WIKI = "https://github.com/ozerozdas/sprigo/wiki";
const QA = "https://github.com/ozerozdas/sprigo/discussions/categories/q-a-help";
const PAGE: Record<HelpTopic, string> = {
  ai: "AI-Model-Setup", aiConnect: "Troubleshooting", weak: "AI-Model-Setup", mic: "Voice-and-Microphone",
  voice: "Voice-and-Microphone", phone: "FAQ", data: "FAQ", offline: "FAQ",
};
const TOPICS = Object.keys(PAGE) as HelpTopic[];

export const openLink = async (url: string) => isTauri ? (await import("@tauri-apps/plugin-opener")).openUrl(url) : window.open(url, "_blank");
const Link = ({ url, children }: { url: string; children: string }) =>
  <a href={url} onClick={(e) => { e.preventDefault(); void openLink(url); }}>{children}</a>;

/** "?" next to a setting: opens Help at its topic (replaces the open sheet; closing goes back to the screen). */
export function HelpButton({ topic }: { topic: HelpTopic }) {
  const { t } = useTranslation();
  const { openSheet } = useApp();
  return <button className="icon-btn" aria-label={`${t("help.open")}: ${t(`help.topics.${topic}.q`)}`} onClick={() => openSheet(<HelpSheet topic={topic} />)}><Icon name="help" /></button>;
}

export function HelpSheet({ topic }: { topic?: HelpTopic }) {
  const { t } = useTranslation();
  const { closeSheet } = useApp();
  const opened = useRef<HTMLDetailsElement>(null);
  useEffect(() => { opened.current?.scrollIntoView({ block: "nearest" }); }, [topic]);
  return (
    <div className="od-stack sheet-wide" style={{ "--od-gap": "14px", textAlign: "left" } as React.CSSProperties}>
      <h3 style={{ textAlign: "center" }}>{t("help.title")}</h3>
      <div className="od-stack" style={{ "--od-gap": "8px" } as React.CSSProperties}>
        {TOPICS.map((k) => (
          <details key={k} open={topic === k} className="help-topic" ref={topic === k ? opened : undefined}>
            <summary>{t(`help.topics.${k}.q`)}</summary>
            <div className="help-answer">
              <p>{t(`help.topics.${k}.a`)}</p>
              <Link url={`${WIKI}/${PAGE[k]}`}>{t("help.more")}</Link>
            </div>
          </details>
        ))}
      </div>
      <p className="small muted" style={{ textAlign: "center" }}>
        {t("help.stuck")} <Link url={QA}>{t("help.qa")}</Link> · <Link url={WIKI}>{t("help.wiki")}</Link>
      </p>
      <div className="sheet-actions">
        <button className="btn btn-ghost btn-block" onClick={closeSheet}>{t("sheet.close")}</button>
      </div>
    </div>
  );
}
