// In-app updates (tauri-plugin-updater): signed builds from GitHub Releases, see tauri.conf.json → plugins.updater.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Update } from "@tauri-apps/plugin-updater";
import { getSetting, isTauri, listProfiles, setSetting } from "./db";
import { useApp } from "./store";
import { cleanNotes } from "./releaseNotes";

const REPO = "ozerozdas/sprigo";
export const betaOn = async () => (await getSetting("update.beta")) === "1";

/** The newer release, or null (also offline, in the browser preview, or before the first release exists).
 *  Beta testers (#41) check the `updater-beta` channel in Rust (check_beta), which also carries stable releases. */
export async function findUpdate(): Promise<Update | null> {
  if (!isTauri) return null;
  try {
    const u = await import("@tauri-apps/plugin-updater");
    if (!(await betaOn())) return await u.check();
    const meta = await (await import("@tauri-apps/api/core")).invoke<ConstructorParameters<typeof u.Update>[0] | null>("check_beta");
    return meta && new u.Update(meta);
  } catch (e) { console.warn("update check", e); return null; }
}

/** Release notes for this version, once: on the first launch after an update (#41). Not on a fresh install. */
export async function whatsNew(): Promise<{ version: string; notes: string } | null> {
  if (!isTauri) return null;
  const version = await (await import("@tauri-apps/api/app")).getVersion(), seen = await getSetting("app.version");
  if (seen === version) return null;
  // Installs from before this check have no "app.version" yet: having a profile means it was an update.
  if (!seen && !(await listProfiles()).length) { await setSetting("app.version", version); return null; }
  try {
    const { fetch } = await import("@tauri-apps/plugin-http");
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/v${version}`, { headers: { Accept: "application/vnd.github+json" } });
    await setSetting("app.version", version); // offline: asked again next launch
    const notes = r.ok ? cleanNotes(((await r.json()) as { body?: string }).body ?? "") : "";
    return notes ? { version, notes } : null;
  } catch (e) { console.warn("release notes", e); return null; }
}

export function WhatsNewSheet({ version, notes }: { version: string; notes: string }) {
  const { t } = useTranslation();
  const { closeSheet } = useApp();
  return (
    <div className="od-stack" style={{ "--od-gap": "14px", textAlign: "left" } as React.CSSProperties}>
      <h3 style={{ textAlign: "center" }}>{t("update.whatsNew", { version })}</h3>
      {/* ponytail: GitHub's markdown shown as plain text; render it if the notes get rich */}
      <p className="small" style={{ whiteSpace: "pre-wrap", maxHeight: "50vh", overflow: "auto" }}>{notes}</p>
      <button className="btn btn-primary btn-block" onClick={closeSheet}>{t("update.gotIt")}</button>
    </div>
  );
}

/** In a sheet, or inline on the "data is from a newer version" boot screen, where there is nothing to go back to. */
export function UpdateSheet({ update, inline }: { update: Update; inline?: boolean }) {
  const { t } = useTranslation();
  const { closeSheet } = useApp();
  const [pct, setPct] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const install = async () => {
    setPct(0); setErr("");
    let total = 0, got = 0;
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress" && total) setPct(Math.round(((got += e.data.chunkLength) / total) * 100));
      });
      await (await import("@tauri-apps/plugin-process")).relaunch();
    } catch (e) { setErr((e as Error).message ?? String(e)); setPct(null); }
  };
  return (
    <div className="od-stack" style={{ "--od-gap": "14px", textAlign: "left" } as React.CSSProperties}>
      <h3 style={{ textAlign: "center" }}>{t("update.title", { version: update.version })}</h3>
      {update.body && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{update.body}</p>}
      {pct !== null && <>
        <div className="progress-track"><div className="progress-fill green" style={{ width: `${pct}%` }} /></div>
        <span className="muted small" role="status">{t("update.downloading", { pct })}</span>
      </>}
      {err && <p className="small" role="alert" style={{ color: "var(--red)", overflowWrap: "anywhere" }}>{err}</p>}
      <button className="btn btn-primary btn-block" disabled={pct !== null} onClick={install}>{t("update.install")}</button>
      {!inline && <button className="btn btn-ghost btn-block" disabled={pct !== null} onClick={closeSheet}>{t("update.later")}</button>}
    </div>
  );
}
