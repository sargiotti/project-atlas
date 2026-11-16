import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { formatUtcInstant, sessionDay, sessionWindow, utcToLocal, type PanelEvent, type PanelSessionsResponse, type Point } from "@atlas/contract";
import LangSwitch from "../../../../components/LangSwitch";
import { getEvent } from "../../../../api/panelEvents";
import { safeVariants } from "../../../../api/mapBundle";
import { getSessions, saveSessions } from "../../../../api/panelSessions";
import { useI18n } from "../../../../i18n/I18nProvider";
import { displayName } from "../../../../lib/pointLabel";
import { HISTORY_LIMIT, historyReducer, initialHistory, type HAction, type HState } from "../../../../lib/pointsHistory";
import { dayLabel as dayChipLabel, weekdayShort } from "../../../../lib/schedule";
import { clearScheduleDraft, loadScheduleDraft, markScheduleOnboardingSeen, saveScheduleDraft, scheduleOnboardingSeen, type ScheduleDraft } from "../../../../lib/scheduleDraft";
import {
  MAX_BODY_BYTES, bodyBytes, countChanges, findProblems, fromServer, mergeDraft, msOf, newKey, sortSessions, toItem,
  type EditorSession,
} from "../../../../lib/scheduleModel";
import { dayBegin, dayEnd, eventDays, type Span } from "../../../../lib/scheduleTime";
import { Link, navigate, setNavigationGuard } from "../../../../lib/router";
import { MarkerToken } from "../../../../markers/Pixel";
import { Dialog, Ic, PanelNotFound } from "../common";
import Preview from "./Preview";
import Quests from "./Quests";
import ShowForm, { type Candidate, type FormValue } from "./ShowForm";
import "../points/points-editor.css";
import "./schedule-editor.css";

const OUTSIDE = "outside";
const kindOf = (p: Point | null): "S" | "L" => (p?.category === "landmark" ? "L" : "S");

type Banner = { kind: "err" | "info"; text: string } | null;
type Toast = { text: string; afterPast: number } | null;
type Hist = HState<EditorSession>;
type HAct = HAction<EditorSession>;
const reducer = historyReducer as (s: Hist, a: HAct) => Hist;

type Base = { sessions: EditorSession[]; points: Point[]; updatedAt: string; dayStart: string };
const toBase = (r: Pick<PanelSessionsResponse, "sessions" | "points" | "eventUpdatedAt" | "dayStart">): Base => ({
  sessions: r.sessions.map(fromServer),
  // Stages first, then landmarks, each in the order the server sent them.
  points: [...r.points.filter((p) => p.category === "stage"), ...r.points.filter((p) => p.category !== "stage")],
  updatedAt: r.eventUpdatedAt,
  dayStart: r.dayStart,
});

type Props = { event: PanelEvent; initial: PanelSessionsResponse; organizerId: string; placeParam: string | null };

/**
 * Slice 13. Everything here is local until Save: add, edit, delete and undo only change `sessions`. Save sends the whole
 * set in one request (the server decides; a stale save is refused with 409 and nothing is overwritten).
 */
export default function EditorView({ event, initial, organizerId, placeParam }: Props) {
  const { t, lang } = useI18n();
  const uid = useId().replace(/:/g, "");
  const [ev, setEv] = useState(event);
  const tz = ev.timeZone;

  // ---- data ----------------------------------------------------------------------------------------------------
  const [base, setBase] = useState<Base>(() => toBase(initial));
  const [h, dispatch] = useReducer(reducer, base.sessions, initialHistory<EditorSession>);
  const sessions = h.points;
  const dirty = useMemo(() => countChanges(base.sessions, sessions), [base.sessions, sessions]);
  const [savedMark, setSavedMark] = useState<EditorSession[] | null>(null);
  const [gone, setGone] = useState(false);
  const { dayStart } = base;
  const win = useMemo(() => sessionWindow(ev.startDate, ev.endDate, dayStart, tz), [ev.startDate, ev.endDate, dayStart, tz]);
  const days = useMemo(() => eventDays(ev.startDate, ev.endDate), [ev.startDate, ev.endDate]);
  const dayOf = useCallback((s: EditorSession) => sessionDay(msOf(s.start), tz, dayStart), [tz, dayStart]);

  // ---- UI state ------------------------------------------------------------------------------------------------
  const [selPlace, setSelPlace] = useState<string | null>(() => (placeParam && initial.points.some((p) => p.id === placeParam) ? placeParam : null));
  const [selDay, setSelDay] = useState<string>(() => {
    const first = placeParam ? base.sessions.filter((s) => s.pointId === placeParam).sort((a, b) => msOf(a.start) - msOf(b.start))[0] : null;
    const d = first ? sessionDay(msOf(first.start), tz, initial.dayStart) : null;
    return d && eventDays(ev.startDate, ev.endDate).includes(d) ? d : ev.startDate;
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [cand, setCand] = useState<Candidate | null>(null);
  const [lastLen, setLastLen] = useState(60);
  const [savedTick, setSavedTick] = useState(0);
  const [toast, setToast] = useState<Toast>(null);
  const [announce, setAnnounce] = useState("");
  const [banner, setBanner] = useState<Banner>(null);
  const [serverBad, setServerBad] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [conflict, setConflict] = useState<"idle" | "reloading" | "failed">("idle");
  const [conflictOpen, setConflictOpen] = useState(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [draftKept, setDraftKept] = useState(true);
  const [questOn, setQuestOn] = useState(() => !scheduleOnboardingSeen() && initial.sessions.length === 0);
  const [problemsShown, setProblemsShown] = useState(false);
  const formAnchor = useRef<HTMLDivElement>(null);

  const places = base.points;
  const place = places.find((p) => p.id === selPlace) ?? null;
  const kind = kindOf(place);
  const pointIds = useMemo(() => new Set(places.map((p) => p.id)), [places]);
  const nameOf = useCallback((p: Point) => displayName(p, t as any), [t]);

  // A draft left by a previous visit (closed tab, conflict): offered once, never applied on its own.
  const [offer, setOffer] = useState<ScheduleDraft | null>(() => {
    const d = loadScheduleDraft(organizerId, event.id);
    if (!d) return null;
    const serverSet = base.sessions;
    const merged = mergeDraft(d.sessions, serverSet, d.baseUpdatedAt === initial.eventUpdatedAt, new Set(initial.points.map((p) => p.id)));
    if (countChanges(serverSet, merged.sessions) === 0 && merged.dropped === 0) {
      clearScheduleDraft(organizerId, event.id);
      return null;
    }
    return d;
  });
  const [droppedNote, setDroppedNote] = useState(0);
  const offerDropped = useMemo(
    () => (offer ? mergeDraft(offer.sessions, base.sessions, offer.baseUpdatedAt === base.updatedAt, pointIds).dropped : 0),
    [offer, base, pointIds],
  );
  const blocking = !!offer || conflictOpen || leaveTo !== null || gone;

  const live = useRef({ sessions, dirty, base, saving, blocking, offer, past: h.past.length });
  live.current = { sessions, dirty, base, saving, blocking, offer, past: h.past.length };

  const say = (text: string) => setAnnounce(text);
  const toastFor = (text: string) => setToast({ text, afterPast: Math.min(live.current.past + 1, HISTORY_LIMIT) });

  // ---- derived lists ---------------------------------------------------------------------------------------------
  const problems = useMemo(() => findProblems(sessions, win), [sessions, win]);
  const placeSessions = useMemo(() => (place ? sortSessions(sessions.filter((s) => s.pointId === place.id)) : []), [sessions, place]);
  const outsideSessions = useMemo(() => sortSessions(sessions.filter((s) => !days.includes(dayOf(s)))), [sessions, days, dayOf]);
  const inOutside = selDay === OUTSIDE;
  const daySessions = useMemo(() => (inOutside ? [] : placeSessions.filter((s) => dayOf(s) === selDay)), [placeSessions, selDay, inOutside, dayOf]);
  const countByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of placeSessions) m.set(dayOf(s), (m.get(dayOf(s)) ?? 0) + 1);
    return m;
  }, [placeSessions, dayOf]);
  const spanOf = (s: EditorSession): Span => ({ id: s.key, startMs: msOf(s.start), endMs: msOf(s.end), title: s.title });
  const spansAll = useMemo(() => placeSessions.map(spanOf), [placeSessions]);
  const spansEditing = useMemo(() => spansAll.filter((s) => s.id !== editing), [spansAll, editing]);

  useEffect(() => {
    if (selDay === OUTSIDE && outsideSessions.length === 0) setSelDay(days[0] ?? ev.startDate);
  }, [selDay, outsideSessions.length, days, ev.startDate]);
  useEffect(() => {
    if (editing && !sessions.some((s) => s.key === editing)) setEditing(null);
  }, [sessions, editing]);
  useEffect(() => {
    if (!fresh) return;
    const id = setTimeout(() => setFresh(null), 1700);
    return () => clearTimeout(id);
  }, [fresh]);

  // ---- actions -------------------------------------------------------------------------------------------------
  const choosePlace = (id: string) => {
    setSelPlace(id);
    setEditing(null);
    if (selDay === OUTSIDE) setSelDay(days[0] ?? ev.startDate);
  };
  const chooseDay = (d: string) => {
    setSelDay(d);
    setEditing(null);
  };

  const add = (v: FormValue, len: number) => {
    if (!place) return;
    const s: EditorSession = { key: newKey(), pointId: place.id, title: v.title, description: v.description, start: formatUtcInstant(v.startMs), end: formatUtcInstant(v.endMs) };
    dispatch({ type: "apply", fn: (ss) => [...ss, s] });
    setLastLen(len);
    setFresh(s.key);
    const text = t("sedToastAdded", { title: v.title });
    toastFor(text);
    say(text);
  };
  const update = (key: string, v: FormValue) => {
    dispatch({ type: "apply", fn: (ss) => ss.map((s) => (s.key === key ? { ...s, title: v.title, description: v.description, start: formatUtcInstant(v.startMs), end: formatUtcInstant(v.endMs) } : s)) });
    setEditing(null);
    setFresh(key);
    const text = t("sedToastUpdated", { title: v.title });
    toastFor(text);
    say(text);
  };
  const remove = (key: string) => {
    const s = live.current.sessions.find((q) => q.key === key);
    if (!s) return;
    dispatch({ type: "apply", fn: (ss) => ss.filter((q) => q.key !== key) });
    setEditing(null);
    const text = t("sedToastDeleted", { title: s.title.trim() });
    toastFor(text);
    say(text);
  };

  // ---- keyboard: save, undo/redo -------------------------------------------------------------------------------
  const act = useRef({ save: () => {} });
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const s = live.current;
      if (s.blocking) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault(); // never the browser's "save page"
        act.current.save();
        return;
      }
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("input, textarea, select, [contenteditable='true']")) return; // the browser's own text undo
      if (k === "z" && !e.shiftKey) dispatch({ type: "undo" });
      else if (k === "y" || (k === "z" && e.shiftKey)) dispatch({ type: "redo" });
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", on, true);
    return () => document.removeEventListener("keydown", on, true);
  }, []);

  // ---- draft: the unsaved work survives a closed tab -------------------------------------------------------------
  const writeDraft = useCallback(() => {
    const s = live.current;
    if (s.offer) return; // the older draft is still waiting for a decision: do not overwrite it
    if (countChanges(s.base.sessions, s.sessions) === 0) clearScheduleDraft(organizerId, event.id);
    else setDraftKept(saveScheduleDraft(organizerId, event.id, s.base.updatedAt, s.sessions) === "ok");
  }, [organizerId, event.id]);
  useEffect(() => {
    if (offer || gone) return;
    const id = setTimeout(writeDraft, 350);
    return () => clearTimeout(id);
  }, [sessions, base, offer, gone, writeDraft]);
  useEffect(() => {
    const on = () => writeDraft();
    window.addEventListener("pagehide", on);
    return () => window.removeEventListener("pagehide", on);
  }, [writeDraft]);

  // ---- leaving: browser warning, and the in-app router guard ---------------------------------------------------
  const unsafe = (dirty > 0 || saving) && !gone;
  useEffect(() => {
    if (!unsafe) return;
    const off = setNavigationGuard((to) => {
      setLeaveTo(to);
      return false;
    });
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      off();
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [unsafe]);

  // ---- save ----------------------------------------------------------------------------------------------------
  useEffect(() => {
    setToast((cur) => (cur && h.past.length !== cur.afterPast ? null : cur));
  }, [h.past.length]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    setBanner((b) => (b && b.kind === "err" ? null : b));
    setServerBad((s) => (s.size ? new Set() : s));
    setProblemsShown(false);
  }, [sessions]);

  const focusSession = (s: EditorSession) => {
    setSelPlace(s.pointId);
    setSelDay(days.includes(dayOf(s)) ? dayOf(s) : OUTSIDE);
    setEditing(s.key);
  };

  const save = async () => {
    const cur = live.current;
    if (cur.saving || blocked || cur.dirty === 0) return;
    setSavedTick((n) => n + 1);
    if (problems.size) {
      const first = sessions.find((s) => problems.has(s.key))!;
      setProblemsShown(true);
      focusSession(first);
      const kindP = problems.get(first.key)!.kind;
      setBanner({ kind: "err", text: kindP === "overlap" ? t("sedErrOverlap") : t("sedErrProblems") });
      say(t("sedErrProblems"));
      return;
    }
    const body = { baseUpdatedAt: cur.base.updatedAt, sessions: cur.sessions.map(toItem) };
    if (bodyBytes(JSON.stringify(body)) > MAX_BODY_BYTES) {
      setBanner({ kind: "err", text: t("sedErrTooBig") });
      return;
    }
    setSaving(true);
    setBanner(null);
    const sentKeys = cur.sessions.map((s) => s.key);
    const r = await saveSessions(event.id, body);
    setSaving(false);
    switch (r.status) {
      case "ok": {
        const server = toBase(r);
        setBase(server);
        dispatch({ type: "reset", points: server.sessions });
        setSavedMark(server.sessions);
        clearScheduleDraft(organizerId, event.id);
        setEditing(null);
        return; // the status chip is a live region: it announces "Saved"
      }
      case "event_changed":
        writeDraft();
        setConflict("idle");
        setConflictOpen(true);
        return;
      case "unauthenticated":
        writeDraft();
        navigate("/panel/login", true, true);
        return;
      case "not_found":
        clearScheduleDraft(organizerId, event.id);
        setGone(true);
        return;
      case "too_large":
        setBanner({ kind: "err", text: t("sedErrTooBig") });
        return;
      case "rate_limited":
        setBlocked(true);
        setBanner({ kind: "err", text: t("pedErrRate", { n: r.retryAfter }) });
        window.setTimeout(() => {
          setBlocked(false);
          setBanner(null);
        }, r.retryAfter * 1000);
        return;
      case "invalid": {
        const bad = new Set(r.fields.map((f) => sentKeys[f.index]).filter((k): k is string => !!k));
        setServerBad(bad);
        const firstKey = [...bad][0];
        const first = firstKey ? cur.sessions.find((s) => s.key === firstKey) : null;
        if (first) focusSession(first);
        const overlap = r.fields.some((f) => f.code === "overlap");
        setBanner({ kind: "err", text: overlap ? t("sedErrOverlap") : bad.size ? t("sedErrField") : t("sedErrFail") });
        return;
      }
      default:
        setBanner({ kind: "err", text: t("sedErrFail") });
    }
  };
  act.current.save = () => void save();

  // A stale save: reload the server's set; the local draft (already written) is offered back afterwards.
  const reload = async () => {
    setConflict("reloading");
    try {
      const [sr, er] = await Promise.all([getSessions(event.id), getEvent(event.id)]);
      if (sr.status === "unauthenticated" || er.status === "unauthenticated") return void navigate("/panel/login", true, true);
      if (sr.status === "not_found" || er.status === "not_found") {
        clearScheduleDraft(organizerId, event.id);
        setConflictOpen(false);
        return void setGone(true);
      }
      if (sr.status !== "ok" || er.status !== "ok") return void setConflict("failed");
      const server = toBase(sr);
      const d = loadScheduleDraft(organizerId, event.id);
      setEv(er.event);
      setBase(server);
      dispatch({ type: "reset", points: server.sessions });
      setSavedMark(null);
      setEditing(null);
      setConflictOpen(false);
      setConflict("idle");
      if (!sr.points.some((p) => p.id === selPlace)) setSelPlace(null);
      const merged = d ? mergeDraft(d.sessions, server.sessions, d.baseUpdatedAt === sr.eventUpdatedAt, new Set(sr.points.map((p) => p.id))) : null;
      if (d && merged && (countChanges(server.sessions, merged.sessions) > 0 || merged.dropped > 0)) setOffer(d);
      else clearScheduleDraft(organizerId, event.id);
    } catch {
      setConflict("failed");
    }
  };

  const restore = () => {
    if (!offer) return;
    const m = mergeDraft(offer.sessions, base.sessions, offer.baseUpdatedAt === base.updatedAt, pointIds);
    dispatch({ type: "reset", points: m.sessions });
    setDroppedNote(m.dropped);
    setSavedMark(null);
    setOffer(null);
  };
  const discard = () => {
    clearScheduleDraft(organizerId, event.id);
    setOffer(null);
  };

  // ---- onboarding ------------------------------------------------------------------------------------------------
  const step = sessions.length > 0 ? (sessions.length === 1 ? 2 : 3) : selPlace ? 1 : 0;
  useEffect(() => {
    if (questOn && step >= 3) markScheduleOnboardingSeen(); // never shown again in this browser
  }, [questOn, step]);
  const closeQuests = () => {
    markScheduleOnboardingSeen();
    setQuestOn(false);
  };

  // ---- render --------------------------------------------------------------------------------------------------
  if (gone) return <PanelNotFound />;

  const map = ev.map;
  const mapUrl = map ? safeVariants([map.small, map.full])[0]?.url : undefined;
  const saved = savedMark === sessions && dirty === 0;
  const chip = saving ? "saving" : dirty > 0 ? "warn" : saved ? (ev.status === "published" ? "live" : "ok") : "idle";
  const chipText = saving ? t("pedSaving") : dirty > 0 ? t("pedStatusDirty") : saved ? (ev.status === "published" ? t("pedSavedLive") : t("pedSavedDraft")) : t("pedStatusClean");
  const when = (d: ScheduleDraft) => new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(d.savedAt);
  const clock = (ms: number) => utcToLocal(ms, tz).time;
  const countLabel = (p: Point) => {
    const n = sessions.filter((s) => s.pointId === p.id).length;
    const k = kindOf(p);
    return t(`sedPlaceCount${k}${n === 1 ? "1" : "N"}` as any, { kind: t(`cat_${p.category}` as any), n });
  };
  const dayCaption = days.includes(selDay) ? dayChipLabel(selDay, lang) : "";

  // Default for a new show: starts where the day's last one ends (when that is still inside the day), keeps the length.
  const lastEnd = daySessions.reduce((m, s) => Math.max(m, msOf(s.end)), 0);
  const addStart = place && lastEnd > 0 && lastEnd <= dayEnd(selDay, dayStart, tz) ? clock(lastEnd) : "";
  const timeLine = (s: EditorSession) => {
    const a = msOf(s.start);
    const b = msOf(s.end);
    const spill = utcToLocal(a, tz).date !== selDay && days.includes(selDay) ? utcToLocal(a, tz).date : null;
    return { text: `${clock(a)}–${clock(b)}`, spill: spill ? `${dayChipLabel(selDay, lang)} ${clock(a)} (${weekdayShort(spill, lang)})` : null };
  };
  const problemText = (s: EditorSession) => {
    const p = problems.get(s.key);
    if (p?.kind === "overlap") return t("sedRowClash", { title: p.with.title.trim() });
    if (p?.kind === "outside") return t("sedRowOutside");
    if (p?.kind === "text") return t("sedRowText");
    return serverBad.has(s.key) ? t("sedErrField") : null;
  };

  const renderRow = (s: EditorSession, withPlace = false) => {
    if (editing === s.key) {
      const sp = places.find((p) => p.id === s.pointId) ?? place;
      const a = msOf(s.start);
      const b = msOf(s.end);
      return (
        <li key={s.key} className="sed-editrow">
          <ShowForm
            key={s.key}
            mode="edit"
            kind={kindOf(sp ?? null)}
            placeName={sp ? nameOf(sp) : ""}
            day={days.includes(selDay) ? selDay : dayOf(s)}
            timeZone={tz}
            dayStart={dayStart}
            window={win}
            others={spansEditing}
            placeCount={placeSessions.length - 1}
            eventCount={sessions.length - 1}
            initial={{ title: s.title, description: s.description, startText: clock(a), endText: clock(b), len: Math.round((b - a) / 60000) }}
            onSubmit={(v) => update(s.key, v)}
            onCancel={() => setEditing(null)}
            onDelete={() => remove(s.key)}
            onCandidate={setCand}
            savedTick={savedTick}
            autoFocus
          />
        </li>
      );
    }
    const tl = timeLine(s);
    const pt = problemText(s);
    const rp = withPlace ? places.find((p) => p.id === s.pointId) : null;
    return (
      <li key={s.key} className={`sed-row${fresh === s.key ? " fresh" : ""}${pt ? " bad" : ""}`}>
        <button type="button" className="sb" onClick={() => (withPlace ? focusSession(s) : setEditing(s.key))} aria-label={`${t("sedEditRow", { title: s.title.trim() })}, ${tl.spill ?? tl.text}`}>
          <span className="tm">
            {tl.text}
            {tl.spill && <small>{tl.spill}</small>}
          </span>
          <span className="tt">
            <b dir="auto">{s.title}</b>
            {rp && <span className="ds">{nameOf(rp)}</span>}
            {s.description && <span className="ds" dir="auto">{s.description}</span>}
            {pt && <span className="pt" role={problemsShown || serverBad.has(s.key) ? "alert" : undefined}>{pt}</span>}
          </span>
        </button>
        <span className="ib">
          <button type="button" className="ibtn" onClick={() => setEditing(s.key)} tabIndex={-1} aria-hidden="true"><Ic n="pencil" size={18} /></button>
          <button type="button" className="ibtn" onClick={() => remove(s.key)} aria-label={t("sedDeleteRow", { title: s.title.trim() })}><Ic n="trash" size={18} /></button>
        </span>
      </li>
    );
  };

  const dayOk = days.includes(selDay);
  const begin = dayOk ? dayBegin(selDay, dayStart, tz) : 0;
  const end = dayOk ? dayEnd(selDay, dayStart, tz) : 1;
  const pos = (ms: number) => Math.min(100, Math.max(0, ((ms - begin) / (end - begin)) * 100));
  const ticks: { ms: number; label: string; mid: boolean }[] = [];
  if (dayOk) {
    for (let m = begin; m < end; m += 3 * 3600_000) {
      const l = utcToLocal(m, tz);
      ticks.push({ ms: m, label: l.time, mid: false });
    }
    for (let m = begin; m < end; m += 3600_000) if (utcToLocal(m, tz).time === "00:00" && m > begin) ticks.push({ ms: m, label: weekdayShort(utcToLocal(m, tz).date, lang), mid: true });
  }

  const noPlaces = places.length === 0;
  const eventInfo = { slug: ev.slug, name: ev.name, timeZone: tz, dayStart, startDate: ev.startDate };
  const head = (n: number, key: string, done: boolean, off = false) => (
    <div className={`sh${done ? " done" : ""}${off ? " off" : ""}`}>
      <span className="num" aria-hidden="true">{done ? <Ic n="check" size={16} /> : n}</span>
      <span>{t(key as any)}</span>
    </div>
  );

  return (
    <div className="ped sed">
      <header className="ped-top">
        <Link to={`/panel/events/${ev.id}`} className="ped-back" aria-label={t("pedBack")}>
          <Ic n="left" size={18} />
          <span className="nm" dir="auto">{ev.name}</span>
        </Link>
        <h1 className="ped-crumb">{t("sedTitle")}</h1>
        <span className="sp" />
        <a className="btn sm ghost" href={`/panel/events/${ev.id}/preview`} target="_blank" rel="noopener"><Ic n="eye" size={16} />{t("sedVisitorPreview")}</a>
        <LangSwitch />
        <button type="button" className="ibtn" onClick={() => dispatch({ type: "undo" })} disabled={!h.past.length} aria-label={t("pedUndo")} title={t("pedUndoTip")}><Ic n="undo" size={20} /></button>
        <button type="button" className="ibtn" onClick={() => dispatch({ type: "redo" })} disabled={!h.future.length} aria-label={t("pedRedo")} title={t("pedRedoTip")}><Ic n="redo" size={20} /></button>
        <div className={`ped-chip ${chip}`} role="status" aria-live="polite">
          <span className="dot" aria-hidden="true" />
          <span>{chipText}</span>
        </div>
        {dirty > 0 && <span className="ped-counter">{dirty === 1 ? t("pedUnsaved1") : t("pedUnsavedN", { n: dirty })}</span>}
        <button type="button" className="btn primary" onClick={() => void save()} disabled={saving || blocked || dirty === 0} title={t("sedKeySave")}>
          <Ic n="check" size={18} />{saving ? t("pedSaving") : t("pedSave")}
        </button>
      </header>

      <aside className="ped-rail sed-rail" aria-label={t("sedPlaces")}>
        <div className="rh">{head(1, "sedStep1", !!place)}</div>
        {place && mapUrl && map && (
          <div className="mm" aria-hidden="true">
            <div className="mm-img" style={{ backgroundImage: `url("${mapUrl}")`, aspectRatio: `${map.full.width} / ${map.full.height}`, transform: `translate(-${place.x * 100}%, -${place.y * 100}%)` }} />
            <span className="mp" />
          </div>
        )}
        <ul className="plist" aria-label={t("sedPlaces")}>
          {places.map((p) => (
            <li key={p.id}>
              <button type="button" className={`prow${p.id === selPlace ? " on" : ""}${questOn && step === 0 ? " nudge" : ""}`} aria-pressed={p.id === selPlace} onClick={() => choosePlace(p.id)}>
                {map && <MarkerToken category={p.category} theme={map.theme} selected={p.id === selPlace} scale={0.55} />}
                <span className="tx">
                  <span className="nm" dir="auto">{nameOf(p)}</span>
                  <span className="ds">{countLabel(p)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="ped-rfoot sed-rfoot">
          <span>{t("sedMissing")} <Link to={`/panel/events/${ev.id}/points`}>{t("sedMissingLink")}</Link></span>
          {!draftKept && <span role="status">{t("pedDraftNotKept")}</span>}
        </div>
      </aside>

      <main className="sed-center">
        <div className="cin">
          {noPlaces ? (
            <div className="pick">
              <Ic n="pin" size={44} />
              <h2>{t("sedNoPlacesT")}</h2>
              <p>{map ? t("sedNoPlacesS") : t("sedNoMapS")}</p>
              <Link to={map ? `/panel/events/${ev.id}/points` : `/panel/events/${ev.id}`} className="btn primary">{map ? t("sedNoPlacesBtn") : t("pedBack")}</Link>
            </div>
          ) : (
            <>
              {head(2, "sedStep2", !!place && days.includes(selDay), !place)}
              <div className="days" role="group" aria-label={t("sedDays")}>
                {days.map((d) => {
                  const n = countByDay.get(d) ?? 0;
                  return (
                    <button key={d} type="button" className={`dtab${d === selDay ? " on" : ""}`} aria-pressed={d === selDay} onClick={() => chooseDay(d)}>
                      {dayChipLabel(d, lang)}
                      {place && <span className={`n${n === 0 ? " z" : ""}`} title={n === 1 ? t("sedDayCount1") : t("sedDayCountN", { n })}>{n}</span>}
                    </button>
                  );
                })}
                {outsideSessions.length > 0 && (
                  <button type="button" className={`dtab warn${inOutside ? " on" : ""}`} aria-pressed={inOutside} onClick={() => chooseDay(OUTSIDE)}>
                    {t("sedOutside")}<span className="n">{outsideSessions.length}</span>
                  </button>
                )}
              </div>
              <p className="dnote"><Ic n="clock" size={14} />{t("sedDayNote", { from: dayStart })}</p>

              {inOutside ? (
                <>
                  <p className="dnote warn"><Ic n="warn" size={14} />{t("sedOutsideNote")}</p>
                  <ul className="slist">{outsideSessions.map((s) => renderRow(s, true))}</ul>
                </>
              ) : !place ? (
                <div className="pick">
                  <Ic n="pin" size={40} />
                  <h2>{t("sedPickT")}</h2>
                  <p>{t("sedPickS")}</p>
                </div>
              ) : (
                <>
                  {head(3, kind === "S" ? "sedStep3" : "sedStep3S", false)}
                  <div className="tl" aria-hidden="true" role="presentation" title={t("sedTimeline")}>
                    {ticks.map((k) => (
                      <span key={`${k.ms}${k.mid}`}>
                        <i className={`tk${k.mid ? " mid" : ""}`} style={{ left: `${pos(k.ms)}%` }} />
                        <span className={`tl-l${k.mid ? " mid" : ""}`} style={{ left: `${pos(k.ms)}%` }}>{k.label}</span>
                      </span>
                    ))}
                    {daySessions.map((s) => (
                      <span key={s.key} className={`tb${editing === s.key ? " ed" : ""}`} style={{ left: `${pos(msOf(s.start))}%`, width: `${Math.max(0.8, pos(msOf(s.end)) - pos(msOf(s.start)))}%` }} onClick={() => setEditing(s.key)}>
                        {s.title}
                      </span>
                    ))}
                    {cand && days.includes(selDay) && (
                      <span className={`tc${cand.bad ? " no" : ""}`} style={{ left: `${pos(cand.startMs)}%`, width: `${Math.max(0.8, pos(cand.endMs) - pos(cand.startMs))}%` }} />
                    )}
                  </div>
                  <p className="s3w" aria-live="polite">
                    <span className="lim">{daySessions.length === 1 ? t("sedDayCount1") : t("sedDayCountN", { n: daySessions.length })}</span>
                  </p>
                  {daySessions.length === 0 ? (
                    <p className="none">{t(`sedNone${kind}` as any)}</p>
                  ) : (
                    <ul className="slist" aria-label={dayCaption}>{daySessions.map((s) => renderRow(s))}</ul>
                  )}
                  {editing === null && (
                    <div ref={formAnchor}>
                      <ShowForm
                        key={`add-${place.id}-${selDay}`}
                        mode="add"
                        kind={kind}
                        placeName={nameOf(place)}
                        day={selDay}
                        timeZone={tz}
                        dayStart={dayStart}
                        window={win}
                        others={spansAll}
                        placeCount={placeSessions.length}
                        eventCount={sessions.length}
                        initial={{ title: "", description: "", startText: addStart, endText: null, len: lastLen }}
                        onSubmit={add}
                        onCandidate={setCand}
                        savedTick={savedTick}
                        nudge={questOn && step === 1}
                      />
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
        {questOn && !offer && !noPlaces && <Quests step={step} onClose={closeQuests} />}
        <div className="ped-stack">
          {droppedNote > 0 && (
            <div className="ped-banner info" role="status">
              <Ic n="info" size={18} /><span>{t("sedDroppedBanner", { n: droppedNote })}</span>
              <button type="button" className="btn sm ghost" onClick={() => setDroppedNote(0)} aria-label={t("cancel")}><Ic n="x" size={16} /></button>
            </div>
          )}
          {toast && (
            <div className="ped-toast" role="status">
              <span dir="auto">{toast.text}</span>
              <button type="button" onClick={() => { dispatch({ type: "undo" }); setToast(null); }}>{t("pedUndo")}</button>
            </div>
          )}
          {banner && <div className={`ped-banner ${banner.kind}`} role="alert"><Ic n="warn" size={18} /><span>{banner.text}</span></div>}
        </div>
      </main>

      <aside className="ped-insp sed-insp" aria-label={t("sedPrevTitle")}>
        <Preview event={eventInfo} places={places} place={place} day={days.includes(selDay) ? selDay : (days[0] ?? ev.startDate)} sessions={sessions} />
      </aside>

      <p className="pe-vh" role="status" aria-live="polite">{announce}</p>

      {offer && (
        <Dialog titleId={`${uid}-dt`} descId={`${uid}-dd`} initialFocus={() => document.getElementById(`${uid}-restore`)} onClose={() => {}} hideEscHint>
          <h2 id={`${uid}-dt`}>{t("sedDraftT")}</h2>
          <p className="pe-dlgp" id={`${uid}-dd`}>{t("sedDraftS", { when: when(offer) })}</p>
          <p className="pe-dlgp">{t("sedDraftMerge")}</p>
          {offerDropped > 0 && <p className="pe-dlgp" role="note"><b>{t("sedDraftDropped", { n: offerDropped })}</b></p>}
          <div className="pe-acts">
            <button type="button" className="btn" onClick={discard}>{t("pedDiscard")}</button>
            <button type="button" id={`${uid}-restore`} className="btn primary" onClick={restore}>{t("pedRestore")}</button>
          </div>
        </Dialog>
      )}
      {conflictOpen && (
        <Dialog titleId={`${uid}-ct`} descId={`${uid}-cd`} initialFocus={() => document.getElementById(`${uid}-reload`)} onClose={() => {}} hideEscHint>
          <h2 id={`${uid}-ct`}>{t("sedConflictT")}</h2>
          <p className="pe-dlgp" id={`${uid}-cd`}>{t("sedConflictS")}</p>
          {conflict === "failed" && <p className="pe-dlgerr" role="alert">{t("sedErrFail")}</p>}
          <div className="pe-acts">
            <button type="button" id={`${uid}-reload`} className="btn primary" disabled={conflict === "reloading"} onClick={() => void reload()}>{t("pedReload")}</button>
          </div>
        </Dialog>
      )}
      {leaveTo !== null && (
        <Dialog titleId={`${uid}-lt`} descId={`${uid}-ld`} initialFocus={() => document.getElementById(`${uid}-stay`)} onClose={() => setLeaveTo(null)}>
          <h2 id={`${uid}-lt`}>{t("pedLeaveT")}</h2>
          <p className="pe-dlgp" id={`${uid}-ld`}>{t("pedLeaveS")}</p>
          <div className="pe-acts">
            <button type="button" className="btn danger" onClick={() => navigate(leaveTo, false, true)}>{t("pedLeave")}</button>
            <button type="button" id={`${uid}-stay`} className="btn primary" onClick={() => setLeaveTo(null)}>{t("pedStay")}</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
