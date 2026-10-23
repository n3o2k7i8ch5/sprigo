// Settings > Data: where the database lives, export, import, reveal. Desktop only.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../store";
import { backupNow, isTauri } from "../db";
import { closeTauriDb, dataLocation, dbFile, lockHolder, restart, type Location } from "../datadir";
import { today } from "../progress";
import { HelpButton } from "../Help";

const gap = (g: string) => ({ "--od-gap": g }) as React.CSSProperties;
const dialog = () => import("@tauri-apps/plugin-dialog");

export function DataSection() {
  const { t } = useTranslation();
  const { openSheet } = useApp();
  const [loc, setLoc] = useState<Location | null>(null);
  useEffect(() => { if (isTauri) dataLocation().then(setLoc); }, []);
  return (
    <>
      <h2 className="section-title">{t("data.section")}</h2>
      <div className="card od-row" style={gap("12px")}>
        <span className="od-field od-fill"><b>{t("data.folder")}</b>
          <span className="muted small" style={{ overflowWrap: "anywhere" }}>{!isTauri ? t("data.desktopOnly") : loc?.dataDir ?? "…"}</span></span>
        <button className="btn btn-ghost" disabled={!loc} onClick={() => loc && openSheet(<DataSheet loc={loc} />)}>{t("settings.change")}</button>
      </div>
    </>
  );
}

type Ask = { kind: "exists"; dir: string } | { kind: "import"; file: string };

function DataSheet({ loc }: { loc: Location }) {
  const { t } = useTranslation();
  const { closeSheet, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const filters = [{ name: t("data.fileType"), extensions: ["db"] }];
  const run = (f: () => Promise<unknown>) => async () => {
    setBusy(true);
    try { await f(); } catch (e) { toast(t("data.failed", { error: e instanceof Error ? e.message : String(e) })); }
    setBusy(false);
  };
  /** Consistent copy into backups/, handed to `use`, then removed. */
  const withSnapshot = async (use: (file: string) => Promise<unknown>) => {
    const name = `tmp-${Date.now()}.db`;
    try { await use(await backupNow(name)); } finally { await invoke("backups_remove", { dir: loc.dataDir, name }).catch(() => {}); }
  };

  /** Points location.json at `dir` and restarts; `copy` first puts this device's data there (what was there moves to its backups/). */
  const switchTo = async (dir: string, copy: boolean) => {
    if (copy) await withSnapshot((src) => invoke("install_db", { src, dir }));
    await invoke("set_data_dir", { dir: dir === loc.defaultDir ? null : dir });
    await restart(); // ponytail: the old folder keeps its sprigo.db (spec: nothing is deleted)
  };
  const moveTo = async (dir: string | null) => {
    if (!dir || dir === loc.dataDir) return;
    const holder = await lockHolder(dir);
    if (holder) return toast(t("data.lockedThere", { device: holder }));
    if (await invoke<boolean>("file_exists", { path: dbFile(dir) })) return setAsk({ kind: "exists", dir });
    await switchTo(dir, true);
  };
  const pickFolder = async () => moveTo(await (await dialog()).open({ directory: true, defaultPath: loc.dataDir }));

  const exportDb = async () => {
    const to = await (await dialog()).save({ defaultPath: `sprigo-${today()}.db`, filters });
    if (!to) return;
    await withSnapshot((from) => invoke("copy_file", { from, to }));
    toast(t("data.exported"));
  };
  const pickImport = async () => {
    const file = await (await dialog()).open({ filters, multiple: false, directory: false });
    if (!file) return;
    if (!(await invoke<boolean>("is_sqlite", { path: file }))) return toast(t("data.notDb"));
    setAsk({ kind: "import", file });
  };
  /** The current file moves to backups/replaced-*.db; migrations run on the next open. */
  const importDb = async (file: string) => {
    await closeTauriDb();
    try { await invoke("install_db", { src: file, dir: loc.dataDir }); }
    catch (e) { console.error("import", e); } // the pool is closed either way, a restart reopens whatever is in place
    await restart();
  };
  const reveal = async () => (await import("@tauri-apps/plugin-opener")).revealItemInDir(dbFile(loc.dataDir));

  const cancel = <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => ask ? setAsk(null) : closeSheet()}>{t("sheet.cancel")}</button>;
  const sheet = { ...gap("12px"), textAlign: "left" } as React.CSSProperties;

  if (ask?.kind === "exists") return (
    <div className="od-stack" style={sheet}>
      <h3 style={{ textAlign: "center" }}>{t("data.existsTitle")}</h3>
      <p className="muted small" style={{ overflowWrap: "anywhere" }}>{ask.dir}</p>
      <p className="small">{t("data.copyNote")}</p>
      <button className="btn btn-primary btn-block" disabled={busy} onClick={run(() => switchTo(ask.dir, false))}>{t("data.useThere")}</button>
      <button className="btn btn-ghost btn-block" disabled={busy} onClick={run(() => switchTo(ask.dir, true))}>{t("data.copyThere")}</button>
      {cancel}
    </div>
  );
  if (ask?.kind === "import") return (
    <div className="od-stack" style={sheet}>
      <h3 style={{ textAlign: "center" }}>{t("data.importTitle")}</h3>
      <p className="muted small" style={{ overflowWrap: "anywhere" }}>{ask.file}</p>
      <p className="small">{t("data.importDesc")}</p>
      <button className="btn btn-danger btn-block" disabled={busy} onClick={run(() => importDb(ask.file))}>{t("data.importConfirm")}</button>
      {cancel}
    </div>
  );
  return (
    <div className="od-stack" style={sheet}>
      <div className="od-row" style={{ ...gap("4px"), justifyContent: "center" }}><h3>{t("data.title")}</h3><HelpButton topic="data" /></div>
      <span className="od-field"><b>{t(loc.dataDir === loc.defaultDir ? "data.default" : "data.folder")}</b>
        <span className="muted small" style={{ overflowWrap: "anywhere" }}>{loc.dataDir}</span></span>
      <p className="small">{t("data.hint")}</p>
      <p className="small" style={{ fontWeight: 800 }}>{t("data.note")}</p>
      <button className="btn btn-primary btn-block" disabled={busy} onClick={run(pickFolder)}>{t("data.move")}</button>
      {loc.dataDir !== loc.defaultDir && <button className="btn btn-ghost btn-block" disabled={busy} onClick={run(() => moveTo(loc.defaultDir))}>{t("data.useDefault")}</button>}
      <div className="od-row" style={gap("10px")}>
        <button className="btn btn-ghost od-fill" disabled={busy} onClick={run(exportDb)}>{t("data.export")}</button>
        <button className="btn btn-ghost od-fill" disabled={busy} onClick={run(pickImport)}>{t("data.import")}</button>
      </div>
      <button className="btn btn-ghost btn-block" disabled={busy} onClick={run(reveal)}>{t("data.reveal")}</button>
      {cancel}
    </div>
  );
}
