import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import type { PanelEvent, Point } from "@atlas/contract";
import LangSwitch from "../../../../components/LangSwitch";
import { getEvent } from "../../../../api/panelEvents";
import { safeVariants } from "../../../../api/mapBundle";
import { getPoints, savePoints, type ServerPoint } from "../../../../api/panelPoints";
import { useI18n } from "../../../../i18n/I18nProvider";
import { displayName } from "../../../../lib/pointLabel";
import { historyReducer, initialHistory, HISTORY_LIMIT } from "../../../../lib/pointsHistory";
import {
  MAX_BODY_BYTES, MAX_POINTS, bodyBytes, countChanges, fromServer, isNameIt, mergeDraft, needsName, newKey, toItem, validate,
  type EditorPoint,
} from "../../../../lib/pointsModel";
import { clearDraft, loadDraft, markOnboardingSeen, onboardingSeen, saveDraft, type Draft } from "../../../../lib/pointsDraft";
import { Link, navigate, setNavigationGuard } from "../../../../lib/router";
import { Dialog, Ic, PanelNotFound } from "../common";
import Inspector from "./Inspector";
import Palette from "./Palette";
import PlacedList from "./PlacedList";
import Quests from "./Quests";
import "./points-editor.css";

const MapViewer = lazy(() => import("../../../../components/MapViewer"));

type Banner = { kind: "err" | "info"; text: string } | null;
type Toast = { text: string; afterPast: number } | null;

const SAFE = { top: 20, bottom: 20 };

// A Point as the shared viewer wants it. Cached per EditorPoint so untouched pins keep their identity (memoized markers).
const viewCache = new WeakMap<EditorPoint, Point>();
const toView = (p: EditorPoint): Point => {
  let v = viewCache.get(p);
  if (!v) {
    v = { id: p.key, name: p.name?.trim() ? p.name : null, category: p.category as Point["category"], description: p.description, x: p.x, y: p.y };
    viewCache.set(p, v);
  }
  return v;
};

const patch = (key: string, change: Partial<EditorPoint>) => (ps: EditorPoint[]) => {
  const i = ps.findIndex((p) => p.key === key);
  if (i < 0) return ps;
  const cur = ps[i]!;
  if ((Object.keys(change) as (keyof EditorPoint)[]).every((k) => cur[k] === change[k])) return ps;
  const next = ps.slice();
  next[i] = { ...cur, ...change };
  return next;
};

type Props = { event: PanelEvent; initial: { points: ServerPoint[]; updatedAt: string }; organizerId: string };

/**
 * Slice 08c. Everything here is local until Save: place, move, name, delete and undo only change `points`. Save sends the
 * full set in one request (the server decides; a stale save is refused with 409 and nothing is overwritten).
 */
export default function EditorView({ event, initial, organizerId }: Props) {
  const { t, lang } = useI18n();
  const uid = useId().replace(/:/g, "");
  const map = event.map!;
  const variants = useMemo(() => safeVariants([map.small, map.full]), [map]);
  const [status, setStatus] = useState(event.status);

  // ---- data ----------------------------------------------------------------------------------------------------
  const [base, setBase] = useState(() => ({ points: initial.points.map(fromServer), updatedAt: initial.updatedAt }));
  const [h, dispatch] = useReducer(historyReducer, base.points, initialHistory);
  const points = h.points;
  const dirty = useMemo(() => countChanges(base.points, points), [base.points, points]);
  const [savedMark, setSavedMark] = useState<EditorPoint[] | null>(null);
  const [gone, setGone] = useState(false);

  // ---- UI state ------------------------------------------------------------------------------------------------
  const [tab, setTab] = useState<"pieces" | "placed">("pieces");
  const [query, setQuery] = useState("");
  const [selKey, setSelKey] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [stamp, setStamp] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [focusReq, setFocusReq] = useState<{ id: string; nonce: number } | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [announce, setAnnounce] = useState("");
  const [banner, setBanner] = useState<Banner>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [serverBad, setServerBad] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [conflict, setConflict] = useState<"idle" | "reloading" | "failed">("idle");
  const [conflictOpen, setConflictOpen] = useState(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [draftKept, setDraftKept] = useState(true);
  const [questOn, setQuestOn] = useState(() => !onboardingSeen() && initial.points.length === 0);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // A draft left by a previous visit (closed tab, conflict): offered once, never applied on its own.
  const [offer, setOffer] = useState<Draft | null>(() => {
    const d = loadDraft(organizerId, event.id);
    if (!d) return null;
    const serverSet = initial.points.map(fromServer);
    if (countChanges(serverSet, mergeDraft(d.points, serverSet, d.baseUpdatedAt === initial.updatedAt)) === 0) {
      clearDraft(organizerId, event.id);
      return null;
    }
    return d;
  });

  const categoryLabel = useCallback((c: string) => t(`cat_${c}` as any), [t]);
  const nameOf = useCallback((p: { name?: string | null; category: string }) => displayName(p, t as any), [t]);

  const mapPoints = useMemo(() => points.map(toView), [points]);
  const pendingIds = useMemo(() => new Set(points.filter(needsName).map((p) => p.key)), [points]);
  const selected = points.find((p) => p.key === selKey) ?? null;
  const blocking = !!offer || conflictOpen || leaveTo !== null || gone;

  // Everything the global key handler needs, as of the latest render.
  const live = useRef({ points, selKey, armed, blocking, dirty, base, saving, offer, past: h.past.length });
  live.current = { points, selKey, armed, blocking, dirty, base, saving, offer, past: h.past.length };

  const say = (text: string) => setAnnounce(text);
  const toastFor = (text: string) => setToast({ text, afterPast: Math.min(live.current.past + 1, HISTORY_LIMIT) });

  // ---- selection -----------------------------------------------------------------------------------------------
  const select = (key: string | null, opts: { name?: boolean; centre?: boolean } = {}) => {
    setSelKey(key);
    setFresh((f) => (f === key ? f : null));
    dispatch({ type: "seal" });
    if (key && opts.centre) setFocusReq((r) => ({ id: key, nonce: (r?.nonce ?? 0) + 1 }));
    if (key && opts.name) setFocusTick((n) => n + 1);
  };
  useEffect(() => {
    if (selKey && !points.some((p) => p.key === selKey)) setSelKey(null);
  }, [points, selKey]);
  useEffect(() => {
    if (focusTick) nameRef.current?.focus();
  }, [focusTick]);
  useEffect(() => {
    if (!stamp) return;
    const id = setTimeout(() => setStamp(null), 600);
    return () => clearTimeout(id);
  }, [stamp]);

  // ---- actions -------------------------------------------------------------------------------------------------
  const place = (category: string, x: number, y: number) => {
    if (live.current.points.length >= MAX_POINTS) return;
    const p: EditorPoint = { key: newKey(), category, name: null, description: "", x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
    dispatch({ type: "apply", fn: (ps) => [...ps, p] });
    setArmed(null);
    setStamp(p.key);
    setQuery("");
    if (isNameIt(category)) {
      setFresh(p.key);
      select(p.key, { name: true });
      say(t("pedPlaced", { name: categoryLabel(category) }));
    } else {
      select(p.key);
      const text = t("pedPlaced", { name: categoryLabel(category) });
      toastFor(text);
      say(text);
    }
  };

  const remove = (key: string) => {
    const p = live.current.points.find((q) => q.key === key);
    if (!p) return;
    const text = t("pedDeleted", { name: needsName(p) ? categoryLabel(p.category) : nameOf(p) });
    dispatch({ type: "apply", fn: (ps) => ps.filter((q) => q.key !== key) });
    setSelKey(null);
    setFresh(null);
    toastFor(text);
    say(text);
  };

  const change = (key: string, c: Partial<Pick<EditorPoint, "name" | "description" | "category">>) => {
    const cur = live.current.points.find((q) => q.key === key);
    if (!cur) return;
    const next: Partial<EditorPoint> = { ...c };
    const cat = c.category ?? cur.category;
    // A Just-drop name that is empty means "no custom name": it goes back to null (the localized label).
    if (!isNameIt(cat)) {
      const nm = c.name !== undefined ? c.name : cur.name;
      if (nm !== null && nm === "") next.name = null;
    }
    const field = c.name !== undefined ? "name" : c.description !== undefined ? "description" : "category";
    dispatch({ type: "apply", fn: patch(key, next), coalesce: field === "category" ? undefined : `edit:${key}:${field}` });
  };

  const dragSeq = useRef(0);
  const dragging = useRef(false);
  const onMarkerDrag = useCallback((key: string, x: number, y: number, phase: "move" | "end") => {
    if (!dragging.current) {
      dragging.current = true;
      dragSeq.current++;
      setSelKey(key);
      setFresh((f) => (f === key ? f : null));
    }
    dispatch({ type: "apply", fn: patch(key, { x, y }), coalesce: `drag:${key}:${dragSeq.current}` });
    if (phase === "end") dragging.current = false;
  }, []);

  const placeInMiddle = () => {
    const c = live.current.armed;
    const st = stageRef.current?.getBoundingClientRect();
    const cv = canvasRef.current?.getBoundingClientRect();
    if (!c || !st || !cv || !st.width) return;
    const x = (cv.left + cv.width / 2 - st.left) / st.width;
    const y = (cv.top + cv.height / 2 - st.top) / st.height;
    place(c, Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)));
  };

  // The latest actions, for handlers registered once (global keys, the map's click callback).
  const act = useRef({ place, remove });
  act.current = { place, remove };

  const onMapClick = useCallback((x: number, y: number, inside: boolean) => {
    const c = live.current.armed;
    if (c && inside) act.current.place(c, x, y);
    else {
      setSelKey(null);
      setFresh(null);
      if (c && !inside) setArmed(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- keyboard: delete, nudge, undo/redo, escape --------------------------------------------------------------
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const s = live.current;
      if (s.blocking) return;
      const el = e.target as HTMLElement | null;
      const typing = !!el?.closest?.("input, textarea, select, [contenteditable='true']");
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (typing) return; // the browser's own text undo
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) dispatch({ type: "undo" });
        else if (k === "y" || (k === "z" && e.shiftKey)) dispatch({ type: "redo" });
        else return;
        e.preventDefault();
        return;
      }
      if (typing || e.altKey) return;
      if (e.key === "Escape") {
        if (s.armed) setArmed(null);
        else if (s.selKey) {
          setSelKey(null);
          setFresh(null);
        }
        return;
      }
      if (!s.selKey) return;
      // Only when the focus is on the map (or nowhere): on a button of the side panels these keys keep their meaning.
      const onMap = !el || el === document.body || !!canvasRef.current?.contains(el);
      if (!onMap) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        act.current.remove(s.selKey);
        return;
      }
      const step = e.shiftKey ? 0.01 : 0.002;
      const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const v = d[e.key];
      if (!v) return;
      e.preventDefault();
      e.stopPropagation(); // the map must not pan under the pin
      const key = s.selKey;
      dispatch({
        type: "apply",
        coalesce: `nudge:${key}`,
        fn: (ps) => {
          const p = ps.find((q) => q.key === key);
          return p ? patch(key, { x: Math.min(1, Math.max(0, p.x + v[0])), y: Math.min(1, Math.max(0, p.y + v[1])) })(ps) : ps;
        },
      });
    };
    document.addEventListener("keydown", on, true);
    return () => document.removeEventListener("keydown", on, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- draft: the unsaved work survives a closed tab (security P4) ---------------------------------------------
  const writeDraft = useCallback(() => {
    const s = live.current;
    if (s.offer) return; // the older draft is still waiting for a decision: do not overwrite it
    if (countChanges(s.base.points, s.points) === 0) clearDraft(organizerId, event.id);
    else setDraftKept(saveDraft(organizerId, event.id, s.base.updatedAt, s.points) === "ok");
  }, [organizerId, event.id]);
  useEffect(() => {
    if (offer || gone) return;
    const id = setTimeout(writeDraft, 350);
    return () => clearTimeout(id);
  }, [points, base, offer, gone, writeDraft]);
  useEffect(() => {
    const on = () => writeDraft();
    window.addEventListener("pagehide", on);
    return () => window.removeEventListener("pagehide", on);
  }, [writeDraft]);

  // ---- leaving: browser warning, and the in-app router guard --------------------------------------------------
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
  }, [points]);

  const save = async () => {
    if (saving || blocked || dirty === 0) return;
    const issues = validate(points);
    if (issues.length) {
      const first = points.find((p) => issues.some((i) => i.key === p.key))!;
      setShowErrors(true);
      select(first.key, { name: true, centre: true });
      setBanner({ kind: "err", text: t("pedErrNeedName") });
      say(t("pedErrNeedName"));
      return;
    }
    const body = { baseUpdatedAt: base.updatedAt, points: points.map(toItem) };
    if (bodyBytes(JSON.stringify(body)) > MAX_BODY_BYTES) {
      setBanner({ kind: "err", text: t("pedErrTooBig") });
      return;
    }
    setSaving(true);
    setBanner(null);
    const sentKeys = points.map((p) => p.key);
    const r = await savePoints(event.id, body);
    setSaving(false);
    switch (r.status) {
      case "ok": {
        const idByIndex = new Map(r.created.map((c) => [c.index, c.id]));
        const server = r.points.map(fromServer);
        const selIndex = selKey ? sentKeys.indexOf(selKey) : -1;
        setBase({ points: server, updatedAt: r.eventUpdatedAt });
        dispatch({ type: "reset", points: server });
        setSavedMark(server);
        clearDraft(organizerId, event.id);
        setShowErrors(false);
        setFresh(null);
        setSelKey(selIndex >= 0 ? (idByIndex.get(selIndex) ?? selKey) : null);
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
        clearDraft(organizerId, event.id);
        setGone(true);
        return;
      case "map_required":
        setBanner({ kind: "err", text: t("pedErrMap") });
        return;
      case "too_large":
        setBanner({ kind: "err", text: t("pedErrTooBig") });
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
        const first = [...bad][0];
        if (first) select(first, { name: true, centre: true });
        setBanner({ kind: "err", text: bad.size ? t("pedErrField") : t("pedErrFail") });
        return;
      }
      default:
        setBanner({ kind: "err", text: t("pedErrFail") });
    }
  };

  // A stale save: reload the server's set; the local draft (already written) is offered back afterwards.
  const reload = async () => {
    setConflict("reloading");
    try {
      const [pr, er] = await Promise.all([getPoints(event.id), getEvent(event.id)]);
      if (pr.status === "unauthenticated" || er.status === "unauthenticated") return void navigate("/panel/login", true, true);
      if (pr.status === "not_found" || er.status === "not_found") {
        clearDraft(organizerId, event.id);
        setConflictOpen(false);
        return void setGone(true);
      }
      if (pr.status !== "ok" || er.status !== "ok") return void setConflict("failed");
      const server = pr.points.map(fromServer);
      const d = loadDraft(organizerId, event.id);
      setBase({ points: server, updatedAt: pr.eventUpdatedAt });
      dispatch({ type: "reset", points: server });
      setStatus(er.event.status);
      setSavedMark(null);
      setSelKey(null);
      setConflictOpen(false);
      setConflict("idle");
      if (d && countChanges(server, mergeDraft(d.points, server, d.baseUpdatedAt === pr.eventUpdatedAt)) > 0) setOffer(d);
      else clearDraft(organizerId, event.id);
    } catch {
      setConflict("failed");
    }
  };

  const restore = () => {
    if (!offer) return;
    dispatch({ type: "reset", points: mergeDraft(offer.points, base.points, offer.baseUpdatedAt === base.updatedAt) });
    setSavedMark(null);
    setOffer(null);
  };
  const discard = () => {
    clearDraft(organizerId, event.id);
    setOffer(null);
  };

  // ---- onboarding ----------------------------------------------------------------------------------------------
  const stageP = points.some((p) => p.category === "stage");
  const stageNamed = points.some((p) => p.category === "stage" && !needsName(p));
  const toiletsP = points.some((p) => p.category === "toilets");
  const step = !stageP ? 0 : !stageNamed ? 1 : !toiletsP ? 2 : 3;
  useEffect(() => {
    if (questOn && step >= 3) markOnboardingSeen(); // never shown again in this browser
  }, [questOn, step]);
  const closeQuests = () => {
    markOnboardingSeen();
    setQuestOn(false);
  };

  // ---- render --------------------------------------------------------------------------------------------------
  const edit = useMemo(
    () => ({ stageRef, onMapClick, onMarkerDrag, pendingIds, highlightId: hover, stampId: stamp, armed: !!armed, tipOf: nameOf }),
    [onMapClick, onMarkerDrag, pendingIds, hover, stamp, armed, nameOf],
  );

  if (gone) return <PanelNotFound />;

  const saved = savedMark === points && dirty === 0;
  const chip = saving ? "saving" : dirty > 0 ? "warn" : saved ? (status === "published" ? "live" : "ok") : "idle";
  const chipText = saving ? t("pedSaving") : dirty > 0 ? t("pedStatusDirty") : saved ? (status === "published" ? t("pedSavedLive") : t("pedSavedDraft")) : t("pedStatusClean");
  const when = (d: Draft) => new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(d.savedAt);
  const atLimit = points.length >= MAX_POINTS;

  return (
    <div className="ped">
      <header className="ped-top">
        <Link to={`/panel/events/${event.id}`} className="ped-back" aria-label={t("pedBack")}>
          <Ic n="left" size={18} />
          <span className="nm" dir="auto">{event.name}</span>
        </Link>
        <h1 className="ped-crumb">{t("pedTitle")}</h1>
        <span className="sp" />
        <LangSwitch />
        <button type="button" className="ibtn" onClick={() => dispatch({ type: "undo" })} disabled={!h.past.length} aria-label={t("pedUndo")} title={t("pedUndoTip")}><Ic n="undo" size={20} /></button>
        <button type="button" className="ibtn" onClick={() => dispatch({ type: "redo" })} disabled={!h.future.length} aria-label={t("pedRedo")} title={t("pedRedoTip")}><Ic n="redo" size={20} /></button>
        <div className={`ped-chip ${chip}`} role="status" aria-live="polite">
          <span className="dot" aria-hidden="true" />
          <span>{chipText}</span>
        </div>
        {dirty > 0 && <span className="ped-counter">{dirty === 1 ? t("pedUnsaved1") : t("pedUnsavedN", { n: dirty })}</span>}
        <button type="button" className="btn primary" onClick={() => void save()} disabled={saving || blocked || dirty === 0}>
          <Ic n="check" size={18} />{saving ? t("pedSaving") : t("pedSave")}
        </button>
      </header>

      <aside className="ped-rail" aria-label={t("pedTabsLabel")}>
        <div className="ped-tabs" role="tablist" aria-label={t("pedTabsLabel")}>
          <button type="button" role="tab" id={`${uid}-t1`} aria-selected={tab === "pieces"} aria-controls={`${uid}-p1`} className={tab === "pieces" ? "on" : ""} onClick={() => setTab("pieces")}>{t("pedTabPieces")}</button>
          <button type="button" role="tab" id={`${uid}-t2`} aria-selected={tab === "placed"} aria-controls={`${uid}-p2`} className={tab === "placed" ? "on" : ""} onClick={() => setTab("placed")}>{t("pedTabPlaced", { n: points.length })}</button>
        </div>
        <div className="ped-rbody" role="tabpanel" id={tab === "pieces" ? `${uid}-p1` : `${uid}-p2`} aria-labelledby={tab === "pieces" ? `${uid}-t1` : `${uid}-t2`}>
          {tab === "pieces" ? (
            <Palette theme={map.theme} armed={armed} onArm={(c) => { setArmed(c); if (c) setSelKey(null); }} onDrop={place} stageRef={stageRef} count={points.length} nudge={questOn && !offer ? (step === 0 ? "stage" : step === 2 ? "toilets" : null) : null} />
          ) : (
            <PlacedList points={points} selKey={selKey} query={query} onQuery={setQuery} onSelect={(k) => select(k, { centre: true })} onHover={setHover} />
          )}
        </div>
        <div className={`ped-rfoot${points.length >= 400 ? " warn" : ""}`}>
          <span>{atLimit ? t("pedLimit") : t("pedCount", { n: points.length, max: MAX_POINTS })}</span>
          {!draftKept && <span role="status">{t("pedDraftNotKept")}</span>}
        </div>
      </aside>

      <main className="ped-canvas" ref={canvasRef}>
        <Suspense fallback={<div className="map-status" role="status">{t("loading")}</div>}>
          <MapViewer
            imageUrl={variants[0]?.url ?? ""}
            variants={variants}
            width={map.full.width}
            height={map.full.height}
            points={mapPoints}
            theme={map.theme}
            selectedId={selKey}
            onSelect={(id) => select(id)}
            focusRequest={focusReq}
            categoryLabel={categoryLabel}
            safe={SAFE}
            edit={edit}
          />
        </Suspense>
        {questOn && !offer && <Quests step={step} onClose={closeQuests} />}
        <div className="ped-stack">
          {toast && (
            <div className="ped-toast" role="status">
              <span dir="auto">{toast.text}</span>
              <button type="button" onClick={() => { dispatch({ type: "undo" }); setToast(null); }}>{t("pedUndo")}</button>
            </div>
          )}
          {banner && <div className={`ped-banner ${banner.kind}`} role="alert"><Ic n="warn" size={18} /><span>{banner.text}</span></div>}
          {armed && (
            <div className="ped-hint" role="status">
              <span>{t("pedArmed", { cat: categoryLabel(armed) })}</span>
              <button type="button" className="btn sm" onClick={placeInMiddle}>{t("pedArmedMid")}</button>
              <button type="button" className="btn sm ghost" onClick={() => setArmed(null)}>{t("cancel")}</button>
            </div>
          )}
        </div>
      </main>

      <aside className="ped-insp" aria-label={t("pedInspector")}>
        <Inspector
          key={selected?.key ?? "none"}
          point={selected}
          fresh={!!selected && fresh === selected.key}
          showErrors={showErrors}
          serverError={!!selected && serverBad.has(selected.key)}
          nameRef={nameRef}
          onChange={(c) => selected && change(selected.key, c)}
          onDelete={() => selected && remove(selected.key)}
          onConfirm={() => {
            if (!selected) return;
            const nm = (selected.name ?? "").trim();
            if (isNameIt(selected.category) && nm === "") return;
            setFresh(null);
            canvasRef.current?.querySelector<HTMLElement>(`[data-point-id="${selected.key}"]`)?.focus({ preventScroll: true });
          }}
          onCancelFresh={() => {
            dispatch({ type: "undo" });
            setSelKey(null);
            setFresh(null);
          }}
        />
      </aside>

      <p className="pe-vh" role="status" aria-live="polite">{announce}</p>

      {offer && (
        <Dialog titleId={`${uid}-dt`} descId={`${uid}-dd`} initialFocus={() => document.getElementById(`${uid}-restore`)} onClose={() => {}} hideEscHint>
          <h2 id={`${uid}-dt`}>{t("pedDraftT")}</h2>
          <p className="pe-dlgp" id={`${uid}-dd`}>{t("pedDraftS", { when: when(offer) })}</p>
          <p className="pe-dlgp" id={`${uid}-dm`}>{t("pedDraftMerge")}</p>
          <div className="pe-acts">
            <button type="button" className="btn" onClick={discard}>{t("pedDiscard")}</button>
            <button type="button" id={`${uid}-restore`} className="btn primary" onClick={restore}>{t("pedRestore")}</button>
          </div>
        </Dialog>
      )}
      {conflictOpen && (
        <Dialog titleId={`${uid}-ct`} descId={`${uid}-cd`} initialFocus={() => document.getElementById(`${uid}-reload`)} onClose={() => {}} hideEscHint>
          <h2 id={`${uid}-ct`}>{t("pedConflictT")}</h2>
          <p className="pe-dlgp" id={`${uid}-cd`}>{t("pedConflictS")}</p>
          {conflict === "failed" && <p className="pe-dlgerr" role="alert">{t("pedErrFail")}</p>}
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
