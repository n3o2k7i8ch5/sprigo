import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "./icons";
import { useApp, type BootError, type Route } from "./store";
import { Rail } from "./Rail";
import { Lesson, sfxState } from "./Lesson";
import { today } from "./progress";
import { nudgeDue, nudgeMessage } from "./nudge";
import { keepInBackground, notify } from "./notify";
import { takeOver, resetDataDir } from "./datadir";
import { findUpdate, UpdateSheet, whatsNew, WhatsNewSheet } from "./Update";
import type { Update } from "@tauri-apps/plugin-updater";
import { Chat, Story } from "./Talk";
import { TutorCall } from "./TutorCall";
import { CHARACTERS, parseTalkId, type CharacterId } from "./characters";
import { Learn } from "./screens/Learn";
import { Garden } from "./screens/Garden";
import { Settings } from "./screens/Settings";
import { Avatar, ProfileGate, useLangName } from "./screens/Profiles";
import { Practice, League, Shop, Profile, Stories, Roleplay, Friends, Notifications, LiveButton } from "./screens/Screens";

const NAV: { id: Route; icon: IconName }[] = [
  { id: "learn", icon: "home" }, { id: "practice", icon: "dumbbell" }, { id: "league", icon: "trophy" },
  { id: "shop", icon: "shop" }, { id: "profile", icon: "user" },
];
const MORE: { id: Route; icon: IconName }[] = [
  { id: "stories", icon: "story" }, { id: "roleplay", icon: "video" }, { id: "friends", icon: "users" },
  { id: "notifications", icon: "bell" }, { id: "settings", icon: "gear" },
];
const SCREENS: Record<Route, () => React.ReactNode> = {
  learn: Learn, practice: Practice, league: League, shop: Shop, profile: Profile,
  stories: Stories, roleplay: Roleplay, friends: Friends, notifications: Notifications, settings: Settings,
  garden: Garden,
};

function NavBtn({ id, icon, onGo }: { id: Route; icon: IconName; onGo?: () => void }) {
  const { route, go } = useApp();
  const { t } = useTranslation();
  const active = route === id;
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={() => { go(id); onGo?.(); }} aria-current={active ? "page" : "false"}>
      <Icon name={icon} /><span>{t(`nav.${id}`)}</span>
    </button>
  );
}

/** Phone bottom bar: the main tabs, then "…" opening profile and the rest upwards. */
function BottomNav() {
  const { t } = useTranslation();
  const { route } = useApp();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const tabs = NAV.filter((n) => n.id !== "profile"), rest = [...NAV.filter((n) => n.id === "profile"), ...MORE];
  const inMore = rest.some((n) => n.id === route);
  return (
    <>
      {open && <div className="more-backdrop" onClick={() => setOpen(false)} />}
      {open && <div className="more-menu" id="more-menu">{rest.map((n) => <NavBtn key={n.id} {...n} onGo={() => setOpen(false)} />)}</div>}
      <nav className="bottom-nav" aria-label={t("nav.bottom")}>
        {tabs.map((n) => <NavBtn key={n.id} {...n} onGo={() => setOpen(false)} />)}
        <button className={`nav-item ${inMore || open ? "active" : ""}`} onClick={() => setOpen((o) => !o)}
          aria-expanded={open} aria-controls="more-menu">
          <Icon name="dots" /><span>{t("nav.more")}</span>
        </button>
      </nav>
    </>
  );
}

function BootErrorScreen({ e }: { e: BootError }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const act = (f: () => Promise<void> | void) => async () => { setBusy(true); try { await f(); } catch (x) { console.error(x); setBusy(false); } };
  // Data folder / lock: retrying is a reload, the boot sequence checks everything again.
  // Phone companion: one device at a time; continuing here reloads, which takes the data back (src/companion.ts).
  if (e.kind === "onPhone" || e.kind === "onDesktop") return (
    <div className="boot-error" role="alert">
      <div className="card od-stack" style={{ "--od-gap": "10px" } as React.CSSProperties}>
        <h3>{t(`boot.${e.kind}Title`)}</h3>
        <p className="muted">{t(`boot.${e.kind}Desc`)}</p>
        <button className="btn btn-primary btn-block" onClick={() => location.reload()}>{t("boot.continueHere")}</button>
      </div>
    </div>
  );
  const retry = <button className="btn btn-primary btn-block" disabled={busy} onClick={() => location.reload()}>{t("boot.retry")}</button>;
  if (e.kind === "unreachable" || e.kind === "locked") return (
    <div className="boot-error" role="alert">
      <div className="card od-stack" style={{ "--od-gap": "10px" } as React.CSSProperties}>
        <h3>{t(e.kind === "locked" ? "boot.lockedTitle" : "boot.unreachableTitle", { device: e.detail })}</h3>
        <p className="muted">{t(e.kind === "locked" ? "boot.lockedDesc" : "boot.unreachableDesc")}</p>
        {e.kind === "unreachable" && <pre className="boot-detail">{e.detail}</pre>}
        {retry}
        {e.kind === "locked"
          ? <button className="btn btn-ghost btn-block" disabled={busy} onClick={act(takeOver)}>{t("boot.takeOver")}</button>
          : <button className="btn btn-ghost btn-block" disabled={busy} onClick={act(resetDataDir)}>{t("boot.useDefault")}</button>}
      </div>
    </div>
  );
  const future = e.kind === "future";
  return <FutureOrFailed e={e} future={future} />;
}

function FutureOrFailed({ e, future }: { e: BootError; future: boolean }) {
  const { t } = useTranslation();
  const [update, setUpdate] = useState<Update | null>(null);
  useEffect(() => { if (future) findUpdate().then(setUpdate); }, [future]);
  return (
    <div className="boot-error" role="alert">
      <div className="card">
        <h3>{t(future ? "boot.newerTitle" : "boot.failedTitle")}</h3>
        <p className="muted">{t(future ? "boot.newerDesc" : "boot.failedDesc")}</p>
        {!future && <pre className="boot-detail">{e.detail}</pre>}
        {update && <UpdateSheet update={update} inline />}
      </div>
    </div>
  );
}

export default function App() {
  const { t, i18n } = useTranslation();
  const { ready, bootError, profile, route, sheet, openSheet, closeSheet, toastMsg, toastOn, lessonId, endLesson, s, setS, course, logout } = useApp();
  const langName = useLangName();
  const Screen = SCREENS[route];
  const talk = lessonId && /^(chat|call|rehearse|drill):/.test(lessonId) ? parseTalkId(lessonId) : undefined;
  const badTalk = talk === null;
  useEffect(() => { if (badTalk) endLesson(); }, [badTalk]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && sheet) closeSheet(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheet, closeSheet]);

  useEffect(() => {
    sfxState.on = s.soundOn;
    document.documentElement.dataset.motion = s.reduceMotion ? "reduce" : "full";
  }, [s.soundOn, s.reduceMotion]);

  // Once per launch, after sign-in so the sheet has somewhere to show: what's new after an update, else a quiet update check.
  useEffect(() => {
    if (profile) whatsNew().then(async (n) => {
      if (n) return openSheet(<WhatsNewSheet {...n} />);
      const u = await findUpdate();
      if (u) openSheet(<UpdateSheet update={u} />);
    });
  }, [!!profile]);

  // ponytail: a PIN-locked profile never auto-signs in, so its reminder only fires once someone signs in
  useEffect(() => { keepInBackground(!!profile && s.reminderOn); }, [profile?.id, s.reminderOn]);

  // Nudges (Settings → Reminders): up to 3 a day, checked every minute while the app runs, even in the background.
  useEffect(() => {
    if (!profile || !s.reminderOn || !course) return;
    const tick = () => {
      const slot = nudgeDue(s);
      if (slot === null) return;
      const day = today();
      setS((x) => ({ ...x, reminded: `${day}:${slot}` }));
      const { group, i } = nudgeMessage(slot, s.streak, day);
      const vars = { count: s.streak, lang: langName(course.iso) };
      notify(t(`nudges.${group}.${i}.t`, vars), t(`nudges.${group}.${i}.b`, vars));
    };
    tick();
    const h = setInterval(tick, 60_000);
    return () => clearInterval(h);
  }, [profile?.id, s.reminderOn, s.lastActive, s.reminded, s.streak, course?.iso, i18n.language]);

  if (bootError) return <BootErrorScreen e={bootError} />;
  if (!ready) return null;
  return (
    <>
      {!profile ? <ProfileGate /> : <>
      <div className="app">
        <aside className="sidebar" aria-label={t("nav.main")}>
          <div className="logo">sprigo</div>
          <nav>
            <LiveButton />
            {NAV.map((n) => <NavBtn key={n.id} {...n} />)}
            <div style={{ margin: "14px 12px 6px", fontSize: 11, fontWeight: 900, letterSpacing: "1.2px", color: "var(--text-faint)", textTransform: "uppercase" }}>
              {t("nav.more")}
            </div>
            {MORE.map((n) => <NavBtn key={n.id} {...n} />)}
          </nav>
          <button className="nav-item nav-more profile-switch" onClick={logout} title={t("settings.logout")} aria-label={`${profile.name} · ${t("settings.logout")}`}>
            <Avatar p={profile} size={30} /><span className="od-fill">{profile.name}</span><Icon name="swap" />
          </button>
        </aside>
        <main className="main">
          <div className="main-inner">
            <div className="center" tabIndex={-1}><Screen /></div>
            <aside className="rail" aria-label={t("rail.label")}><Rail /></aside>
          </div>
        </main>
      </div>
      <BottomNav />

      {lessonId && (lessonId.startsWith("story:") ? <Story unitId={lessonId.slice(6)} />
        : lessonId.startsWith("tutor:") ? (lessonId.slice(6) in CHARACTERS && <TutorCall key={lessonId} who={lessonId.slice(6) as CharacterId} />)
        : /^(chat|call|rehearse|drill):/.test(lessonId) ? (talk && <Chat key={lessonId} talk={talk} />) : <Lesson id={lessonId} />)}
      </>}

      <div className={`sheet-scrim ${sheet ? "open" : ""}`} onClick={(e) => e.target === e.currentTarget && closeSheet()}>
        <div className="sheet" role="dialog" aria-modal="true">{sheet}</div>
      </div>
      <div className={`toast ${toastOn ? "show" : ""}`} role="status">{toastMsg}</div>
    </>
  );
}
