import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { sessionDay, utcToLocal, type EventInfo, type Point } from "@atlas/contract";
import { useI18n } from "../i18n/I18nProvider";
import { displayName } from "../lib/pointLabel";
import { preStartCopy } from "../lib/preStart";
import { deviceTimeZone, durationLabel, utcOffsetLabel, weekdayShort, type TimedSession } from "../lib/schedule";
import {
  ZOOM_STEPS,
  bucketByDay,
  dayTabLabel,
  daySpan,
  isRunning,
  layoutColumn,
  longDate,
  shortDate,
  openingFor,
  placeColorIndex,
  readZoom,
  weekdayLong,
  writeZoom,
} from "../lib/scheduleGrid";

const MIN = 60_000;
const HOUR = 60 * MIN;
const GUTTER = 48; // px, sticky time column
const HEAD = 46; // px, sticky place header
const PT = 10; // px, space above the first hour line
const NOW_FRAC = 0.25; // where the Now line lands when the grid opens or jumps to now

/** Real clock re-evaluated about once a minute while the view is shown; a simulated time (`?at=`) stays fixed. */
function useNow(fixed: number | null, active: boolean) {
  const [real, setReal] = useState(() => Date.now());
  useEffect(() => {
    if (fixed !== null || !active) return;
    setReal(Date.now());
    const id = setInterval(() => setReal(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [fixed, active]);
  return fixed ?? real;
}

function smoothTo(el: HTMLElement, top: number) {
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (typeof el.scrollTo === "function") el.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  else el.scrollTop = Math.max(0, top);
}

const arrows = {
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  left: "M19 12H5M11 6l-6 6 6 6",
  right: "M5 12h14M13 6l6 6-6 6",
};

type Props = {
  active: boolean;
  event: Pick<EventInfo, "timeZone" | "dayStart">;
  points: Point[];
  sessions: TimedSession[];
  atMs: number | null;
  /** Session outlined in the grid (the one whose sheet is open). */
  selectedSessionId: string | null;
  sheetOpen: boolean;
  /** Changes whenever a block is tapped, so the grid can scroll it into view above the sheet. */
  revealNonce: number;
  onPickSession: (s: TimedSession) => void;
  /** Slice 13: the organizer's preview opens on this day (the grid is remounted when it changes). */
  initialDay?: string;
};

type Pending =
  | { type: "zoom"; anchorMs: number; viewY: number }
  | { type: "day" }
  | { type: "now" }
  | { type: "reveal" };

export default function ScheduleView(props: Props) {
  const { active, event, points, sessions, atMs, selectedSessionId, sheetOpen, revealNonce, onPickSession, initialDay } = props;
  const { t, lang } = useI18n();
  const { timeZone, dayStart } = event;
  const now = useNow(atMs, active);

  // Bucketing happens once per bundle, not per scroll, zoom or tick.
  const buckets = useMemo(() => bucketByDay(sessions, points.map((p) => p.id)), [sessions, points]);
  const colorOf = useMemo(() => placeColorIndex(sessions, points.map((p) => p.id)), [sessions, points]);
  const pointById = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);
  const { days, byDay } = buckets;

  const opening = useMemo(
    () => openingFor(sessions, days, now, timeZone, dayStart),
    [sessions, days, now, timeZone, dayStart],
  );
  // Where the grid opens is decided once, with the clock of that moment.
  const initial = useRef(opening);
  const [picked, setPicked] = useState<string | null>(initialDay ?? null);
  const [zoom, setZoom] = useState(readZoom);
  const ppm = ZOOM_STEPS[zoom]!.ppm;
  const minH = ppm < 1 ? 24 : 44;

  const scroller = useRef<HTMLDivElement>(null);
  const pending = useRef<Pending | null>(null);
  const saved = useRef({ top: 0, left: 0 });
  const opened = useRef(false);

  const day = picked && days.includes(picked) ? picked : (initial.current?.day ?? days[0] ?? "");
  const running = opening ? isRunning(opening.state) : false;
  const nowDay = running ? sessionDay(now, timeZone, dayStart) : null;
  // The tab "now" belongs to (a quiet night can fall on a day without Sessions).
  const nowTab = nowDay ? (days.includes(nowDay) ? nowDay : (days.find((d) => d > nowDay) ?? days[days.length - 1]!)) : null;
  const nowOnGrid = nowDay !== null && nowDay === day;

  const dayMap = byDay.get(day);
  const daySessions = useMemo(() => (dayMap ? [...dayMap.values()].flat() : []), [dayMap]);
  const span = useMemo(() => daySpan(daySessions, timeZone, nowOnGrid ? now : null), [daySessions, timeZone, nowOnGrid, now]);
  const columns = useMemo(
    () => (dayMap ? [...dayMap.values()].map((items) => layoutColumn(items, span.startMs, ppm, minH)) : []),
    [dayMap, span.startMs, ppm, minH],
  );

  const y = (ms: number) => PT + ((ms - span.startMs) / MIN) * ppm; // px inside the cells area
  const bodyH = PT + ((span.endMs - span.startMs) / MIN) * ppm + 8;

  // Hour ticks (labels follow the wall clock; positions follow real elapsed time, so DST days stay correct).
  const ticks = useMemo(() => {
    const out: { ms: number; time: string; date: string }[] = [];
    for (let m = span.startMs; m <= span.endMs && out.length < 80; m += HOUR) {
      const { date, time } = utcToLocal(m, timeZone);
      out.push({ ms: m, time, date });
    }
    return out;
  }, [span.startMs, span.endMs, timeZone]);
  const chipStep = span.endMs - span.startMs <= 6 * HOUR ? 1 : 2;
  const chips = ticks.filter((_, i) => i % chipStep === 0 && i < ticks.length - 1);

  // Midnight divider inside the span (after-midnight Sessions stay under the day they belong to).
  const midnight = useMemo(() => {
    const first = ticks.find((x) => x.time === "00:00" && x.ms > span.startMs && x.ms < span.endMs);
    return first ?? null;
  }, [ticks, span.startMs, span.endMs]);

  // ---- scroll bookkeeping (passive, one frame at a time) ---------------------------------
  const [info, setInfo] = useState({ topMs: 0, nowDir: "none" as "none" | "up" | "down", more: false });
  const raf = useRef(0);
  const measure = () => {
    const el = scroller.current;
    if (!el) return;
    saved.current = { top: el.scrollTop, left: el.scrollLeft };
    const gridH = Math.max(1, el.clientHeight - HEAD);
    const topMs = span.startMs + ((el.scrollTop + NOW_FRAC * gridH - PT) / ppm) * MIN;
    let nowDir: "none" | "up" | "down" = "none";
    if (nowOnGrid) {
      const ny = y(now) - el.scrollTop;
      nowDir = ny < 0 ? "up" : ny > gridH ? "down" : "none";
    }
    const more = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setInfo((p) => (p.nowDir === nowDir && p.more === more && Math.abs(p.topMs - topMs) < 1 ? p : { topMs, nowDir, more }));
  };
  const onScroll = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      measure();
    });
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // ---- scroll targets ---------------------------------------------------------------------
  const gridHeightOf = (el: HTMLElement) => Math.max(1, el.clientHeight - HEAD);
  const topFor = (ms: number, frac: number, el: HTMLElement) => y(ms) - frac * gridHeightOf(el);

  /** Opening position of the selected day, by the opening rule. */
  const openTop = (el: HTMLElement) => {
    const o = initial.current;
    const first = Math.min(...daySessions.map((s) => s.startMs));
    if (o && running && nowOnGrid) {
      if (opening!.state === "live") return topFor(now, NOW_FRAC, el);
      const next = opening!.next;
      if (next && next.day === day && ((next.startMs - now) / MIN) * ppm < 0.6 * gridHeightOf(el)) return topFor(now, NOW_FRAC, el);
      if (next && next.day === day) return y(next.startMs) - 12;
    }
    if (o?.state === "gap" && o.next && o.next.day === day) return y(o.next.startMs) - 12;
    return y(first) - 12;
  };

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const p = pending.current;
    pending.current = null;
    if (!opened.current && active) {
      opened.current = true;
      el.scrollTop = openTop(el);
    } else if (p?.type === "zoom") {
      el.scrollTop = PT + ((p.anchorMs - span.startMs) / MIN) * ppm - p.viewY;
    } else if (p?.type === "day") {
      el.scrollTop = nowOnGrid ? topFor(now, NOW_FRAC, el) : openTop(el);
      el.scrollLeft = 0;
    } else if (p?.type === "now") {
      if (nowOnGrid) smoothTo(el, topFor(now, NOW_FRAC, el));
      else smoothTo(el, y(Math.min(...daySessions.map((s) => s.startMs))) - 12);
    } else if (p?.type === "reveal") {
      reveal(el);
    }
    measure();
  });

  // The pane is hidden (not unmounted) when another view is shown: put the scroll back when it returns.
  const wasActive = useRef(active);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (active && !wasActive.current && el) {
      el.scrollTop = saved.current.top;
      el.scrollLeft = saved.current.left;
    }
    wasActive.current = active;
  }, [active]);

  // Scroll a tapped block into view above the phone sheet.
  const reveal = (el: HTMLElement) => {
    if (!selectedSessionId) return;
    let target: HTMLElement | null = null;
    for (const n of el.querySelectorAll<HTMLElement>("[data-session-id]")) {
      if (n.dataset.sessionId === selectedSessionId) {
        target = n;
        break;
      }
    }
    if (!target) return;
    const phone = typeof matchMedia === "function" && matchMedia("(max-width: 767.98px)").matches;
    const sheetH = phone ? 330 : 0;
    const r = el.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const visibleBottom = r.bottom - sheetH - 8;
    if (b.bottom > visibleBottom || b.top < r.top + HEAD) el.scrollTop += b.top - (r.top + HEAD + 12);
    if (b.left < r.left + GUTTER) el.scrollLeft -= r.left + GUTTER - b.left + 4;
    else if (b.right > r.right) el.scrollLeft += b.right - r.right + 4;
  };
  const lastReveal = useRef(revealNonce);
  useEffect(() => {
    if (revealNonce === lastReveal.current) return;
    lastReveal.current = revealNonce;
    pending.current = { type: "reveal" };
    setTick((n) => n + 1); // re-render with the grown bottom padding, then reveal in the layout effect
  }, [revealNonce]);
  const [, setTick] = useState(0);

  // ---- controls ---------------------------------------------------------------------------
  const setStep = (i: number, viewY?: number) => {
    const el = scroller.current;
    const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, i));
    if (next === zoom) return;
    if (el) {
      const vy = viewY ?? gridHeightOf(el) / 2;
      pending.current = { type: "zoom", anchorMs: span.startMs + ((el.scrollTop + vy - PT) / ppm) * MIN, viewY: vy };
    }
    writeZoom(next);
    setZoom(next);
  };

  // Pinch jumps one step when the fingers lift; Ctrl + wheel steps once per gesture.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; midY: number } | null>(null);
  const dist = () => {
    const [a, b] = [...touches.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      const r = scroller.current!.getBoundingClientRect();
      pinch.current = { dist: dist(), midY: (a!.y + b!.y) / 2 - r.top - HEAD };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    if (!touches.current.has(e.pointerId)) return;
    const p = pinch.current;
    if (p && touches.current.size === 2) {
      const ratio = dist() / (p.dist || 1);
      if (ratio > 1.2) setStep(zoom + 1, p.midY);
      else if (ratio < 0.83) setStep(zoom - 1, p.midY);
      pinch.current = null;
    }
    touches.current.delete(e.pointerId);
  };
  const wheelLock = useRef(0);
  const stepRef = useRef(setStep);
  stepRef.current = setStep;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const nowT = Date.now();
      if (nowT - wheelLock.current < 300) return;
      wheelLock.current = nowT;
      stepRef.current(zoomRef.current + (e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const pickDay = (d: string) => {
    if (d === day) return;
    pending.current = { type: "day" };
    setPicked(d);
  };
  const jumpNow = () => {
    if (!nowTab) return;
    if (nowTab !== day) {
      pending.current = { type: "now" };
      setPicked(nowTab);
      return;
    }
    const el = scroller.current;
    if (el) smoothTo(el, nowOnGrid ? topFor(now, NOW_FRAC, el) : y(Math.min(...daySessions.map((s) => s.startMs))) - 12);
  };
  const jumpHour = (ms: number) => {
    const el = scroller.current;
    if (el) smoothTo(el, y(ms) - 2);
  };

  // Keep the active hour chip in view inside the (sideways scrolling) chip row.
  const chipRow = useRef<HTMLDivElement>(null);
  const activeChipMs = [...chips].reverse().find((c) => c.ms <= info.topMs)?.ms ?? chips[0]?.ms;
  useEffect(() => {
    const row = chipRow.current;
    const btn = row?.querySelector<HTMLElement>('[aria-current="true"]');
    if (row && btn) row.scrollLeft = btn.offsetLeft - row.clientWidth / 2 + btn.offsetWidth / 2;
  }, [activeChipMs]);

  // ---- text -------------------------------------------------------------------------------
  const localDateOf = (ms: number) => utcToLocal(ms, timeZone).date;
  let status = "";
  let pre: { rel: string; abs: string } | null = null;
  if (opening && initial.current) {
    if (opening.state === "before" && opening.first) {
      const startMs = opening.first.startMs;
      const copy = preStartCopy(startMs, now, timeZone);
      if (copy) {
        const local = utcToLocal(startMs, timeZone);
        const rel =
          copy.key === "preInMin" ? t("preInMin", { n: String(copy.n) })
          : copy.key === "preInDur" ? t("preInDur", { dur: durationLabel(copy.minutes, t("unitH")) })
          : copy.key === "preToday" ? t("preToday", { time: copy.time })
          : copy.key === "preTomorrow" ? t("preTomorrow")
          : copy.key === "preInDays" ? t("preInDays", { n: String(copy.n) })
          : t("preOnDate", { date: longDate(copy.date, lang) });
        pre = { rel, abs: copy.key === "preOnDate" ? local.time : `${shortDate(local.date, lang)} · ${local.time}` };
      }
    } else if (opening.state === "after") status = t("schOver");
    else if (opening.state === "gap" && opening.next) {
      const n = opening.next;
      const time = utcToLocal(n.startMs, timeZone).time;
      const when = n.day === nowDay ? time : `${weekdayLong(localDateOf(n.startMs), lang)} ${time}`;
      status = t("schGap", { when });
    }
  }
  const differentZone = (() => {
    const z = deviceTimeZone();
    return z !== null && z !== timeZone;
  })();
  const stepNames = [t("schZoomCompact"), t("schZoomNormal"), t("schZoomDetail")];

  if (!opening) {
    return (
      <div className={"sched" + (active ? "" : " off")}>
        <p className="sched-empty" role="status">{t("schNone")}</p>
      </div>
    );
  }

  const showNowChip = running;
  const nowChipArrow: keyof typeof arrows | null = !nowTab
    ? null
    : nowTab !== day
      ? nowTab < day
        ? "left"
        : "right"
      : nowOnGrid && info.nowDir !== "none"
        ? info.nowDir
        : null;
  const nowChipOn = showNowChip && nowOnGrid && info.nowDir === "none";
  const colWidth = (lanes: number) => ({ "--lanes": lanes }) as React.CSSProperties;

  return (
    <div className={"sched" + (sheetOpen ? " has-sheet" : "")}>
      {pre && (
        <div className="sched-status pre">
          <span className="ico" aria-hidden="true">
            <svg className="ln" viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          </span>
          <span className="t">
            <span className="rel">{pre.rel}</span>
            <span className="abs">{pre.abs}</span>
          </span>
        </div>
      )}
      {status && (
        <div className="sched-status" role="status">
          <svg className="ln" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span>{status}</span>
        </div>
      )}

      <div className="sched-tools">
        <div className="days" role="group" aria-label={t("sDays")}>
          {days.map((d) => (
            <button key={d} type="button" aria-pressed={d === day} className={d === day ? "on" : ""} onClick={() => pickDay(d)}>
              {dayTabLabel(d, lang)}
              {running && nowDay === d && <span className="dot" aria-hidden="true" />}
            </button>
          ))}
        </div>
        <div className="zstep" role="group" aria-label={t("schZoom")}>
          <button type="button" onClick={() => setStep(zoom - 1)} disabled={zoom === 0} aria-label={t("zoomOut")}>
            <svg className="ln" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 12h14" /></svg>
          </button>
          <span className="lv" aria-hidden="true">
            {[0, 1, 2].map((i) => <i key={i} className={i <= zoom ? "on" : ""} />)}
          </span>
          <button type="button" onClick={() => setStep(zoom + 1)} disabled={zoom === ZOOM_STEPS.length - 1} aria-label={t("zoomIn")}>
            <svg className="ln" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <span className="sr-only" aria-live="polite">{stepNames[zoom]}</span>
        </div>
      </div>

      <div className="sched-hours">
        {showNowChip && (
          <button type="button" className={"hnow" + (nowChipOn ? " on" : "")} onClick={jumpNow}>
            <span className="nd" aria-hidden="true" />
            {t("sNow")}
            {nowChipArrow && (
              <svg className="ln" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d={arrows[nowChipArrow]} /></svg>
            )}
          </button>
        )}
        <div className="hscroll" ref={chipRow} role="group" aria-label={t("schHours")}>
          {chips.map((c) => (
            <button key={c.ms} type="button" aria-current={c.ms === activeChipMs ? "true" : undefined} className={c.ms === activeChipMs ? "on" : ""} onClick={() => jumpHour(c.ms)}>
              {c.time}
              {c.time === "00:00" && <small>{weekdayShort(c.date, lang)}</small>}
            </button>
          ))}
        </div>
      </div>

      <div className="gwrap">
        <div
          className="scroll"
          ref={scroller}
          onScroll={onScroll}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          tabIndex={0}
          role="region"
          aria-label={t("schGrid", { day: dayTabLabel(day, lang) })}
        >
          <div className="grid">
            <div className="ggut" style={{ width: GUTTER }}>
              <div className="gcorner" style={{ height: HEAD }}>
                {differentZone && (
                  <span role="img" title={t("tzCaption", { offset: utcOffsetLabel(now, timeZone) })} aria-label={t("tzCaption", { offset: utcOffsetLabel(now, timeZone) })}>
                    {utcOffsetLabel(now, timeZone)}
                  </span>
                )}
              </div>
              <div className="ghours" style={{ height: bodyH }} aria-hidden="true">
                {ticks.map((k) => {
                  const near = nowOnGrid && Math.abs(k.ms - now) * (ppm / MIN) < 15;
                  return near ? null : (
                    <span key={k.ms} style={{ top: y(k.ms) }}>
                      {k.time}
                      {k.time === "00:00" && k.ms > span.startMs && <small>{weekdayShort(k.date, lang)}</small>}
                    </span>
                  );
                })}
                {ppm >= 2.2 &&
                  ticks.slice(0, -1).map((k) => (
                    <span key={`h${k.ms}`} className="half" style={{ top: y(k.ms + 30 * MIN) }}>:30</span>
                  ))}
                {nowOnGrid && (
                  <span className="nowpill" style={{ top: y(now) }}>{utcToLocal(now, timeZone).time}</span>
                )}
              </div>
            </div>

            {columns.map((c) => {
              const p = pointById.get(c.pointId);
              return (
                <div key={c.pointId} className={`gcol stage-c${colorOf.get(c.pointId) ?? 0}`} style={colWidth(c.maxLanes)}>
                  <h3 className="gch" style={{ height: HEAD }}>
                    <span>{p ? displayName(p, t) : ""}</span>
                  </h3>
                  <ul
                    className={"gcells" + (ppm >= 2.2 ? " halfs" : "")}
                    aria-label={p ? displayName(p, t) : undefined}
                    style={{ height: bodyH, "--hh": `${60 * ppm}px`, "--pt": `${PT}px` } as React.CSSProperties}
                  >
                    {c.blocks.map((b) => {
                      const s = b.session;
                      const st = !running ? "" : s.endMs <= now ? "past" : s.startMs <= now ? "now" : "later";
                      const compact = b.height < 40;
                      const showMeta = b.height >= 52;
                      const showPill = st === "now" && b.height >= 74;
                      const lines = Math.max(1, Math.min(5, Math.floor((b.height - 10 - (showMeta ? 16 : 0) - (showPill ? 20 : 0)) / 16.3)));
                      const range = `${utcToLocal(s.startMs, timeZone).time}–${utcToLocal(s.endMs, timeZone).time}`;
                      const stateName = st === "now" ? t("sNow") : st === "past" ? t("sEnded") : st === "later" ? t("sLater") : "";
                      const lw = `(100% - 6px) / ${b.lanes}`;
                      return (
                        <li
                          key={s.id}
                          style={{ top: PT + b.top, height: b.height, left: `calc(3px + ${b.lane} * ${lw})`, width: `calc(${lw} - ${b.lanes > 1 ? 3 : 0}px)` }}
                        >
                          <button
                            type="button"
                            data-session-id={s.id}
                            className={`blk ${st}${compact ? " c" : ""}${selectedSessionId === s.id ? " sel" : ""}`}
                            aria-current={selectedSessionId === s.id ? "true" : undefined}
                            aria-label={`${s.title}, ${p ? displayName(p, t) : ""}, ${range}${stateName ? `, ${stateName}` : ""}`}
                            onClick={() => onPickSession(s)}
                          >
                            {showPill && <span className="pill now">{t("sNow")}</span>}
                            <span className="bt" style={{ WebkitLineClamp: lines }}>
                              {st === "now" && !showPill && <i className="ndot" aria-hidden="true" />}
                              {s.title}
                            </span>
                            {showMeta && <span className="bm">{range}</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}

            {midnight && <div className="gmid" aria-hidden="true" style={{ top: HEAD + y(midnight.ms), left: GUTTER }} />}
            {nowOnGrid && <div className="gnow" aria-hidden="true" style={{ top: HEAD + y(now), left: GUTTER }} />}
          </div>
          <div className="gpad" />
        </div>
        <div className={"hshade" + (info.more ? " on" : "")} aria-hidden="true" />
      </div>
    </div>
  );
}

/** Keeps a rendering error inside the Schedule view: Map and List keep working. */
export class ScheduleBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    // Nothing to report: the UI already says it. Never log organizer text.
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
