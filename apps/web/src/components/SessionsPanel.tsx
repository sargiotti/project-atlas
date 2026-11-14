import { useEffect, useMemo, useState } from "react";
import { sessionDay, type EventInfo, type Point } from "@atlas/contract";
import { useI18n } from "../i18n/I18nProvider";
import AddToCalendar from "./AddToCalendar";
import type { CalendarInput } from "../lib/calendar";
import {
  cityOfZone,
  dayChipLabel,
  daysOf,
  defaultDay,
  deviceTimeZone,
  durationLabel,
  spillDate,
  splitDay,
  timeLabel,
  weekdayShort,
  type TimedSession,
} from "../lib/schedule";

/** Real clock, re-evaluated every minute; a simulated time (`?at=`) stays fixed. */
function useNow(fixed: number | null) {
  const [real, setReal] = useState(() => Date.now());
  useEffect(() => {
    if (fixed !== null) return;
    const id = setInterval(() => setReal(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [fixed]);
  return fixed ?? real;
}

/** Proposal A of deliverable 08: day chips, Now/Next hero card, later sessions, collapsed earlier ones. All text is React text. */
export default function SessionsPanel({
  point,
  event,
  sessions,
  atMs,
}: {
  point: Point;
  event: Pick<EventInfo, "slug" | "name" | "timeZone" | "dayStart">;
  sessions: TimedSession[];
  atMs: number | null;
}) {
  const { t, lang } = useI18n();
  const { timeZone, dayStart } = event;
  const now = useNow(atMs);
  const days = useMemo(() => daysOf(sessions), [sessions]);
  const [picked, setPicked] = useState<string | null>(null);
  const [showEarlier, setShowEarlier] = useState(false);
  const day = picked && days.includes(picked) ? picked : defaultDay(days, now, timeZone, dayStart);
  const isToday = day === sessionDay(now, timeZone, dayStart);
  const todays = useMemo(() => sessions.filter((s) => s.day === day), [sessions, day]);
  const { now: running, future, past } = splitDay(todays, now);
  const hero = running ?? future[0] ?? null;
  const rest = running ? future : future.slice(1);
  const dur = (min: number) => durationLabel(min, t("unitH"));
  const deviceZone = deviceTimeZone();
  const differentZone = deviceZone !== null && deviceZone !== timeZone;

  // "21:30", or "00:30 Sat" when the local date differs from the grid day (after-midnight sessions).
  const clock = (ms: number) => {
    const spill = spillDate(ms, timeZone, day);
    return spill ? `${timeLabel(ms, timeZone)} ${weekdayShort(spill, lang)}` : timeLabel(ms, timeZone);
  };
  const calInput = (s: TimedSession): CalendarInput => ({
    session: s,
    placeName: point.name,
    eventName: event.name,
    slug: event.slug,
    origin: __PUBLIC_ORIGIN__,
  });

  const heroSub = running
    ? t("sLeft", { d: dur((running.endMs - now) / 60000) })
    : hero && isToday
      ? t("sStartsIn", { d: dur((hero.startMs - now) / 60000) })
      : "";
  const pct = running
    ? Math.min(100, Math.max(0, Math.round(((now - running.startMs) / (running.endMs - running.startMs)) * 100)))
    : 0;

  return (
    <div className="sessions">
      <div className="days" role="group" aria-label={t("sDays")}>
        {days.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={d === day}
            className={d === day ? "on" : ""}
            onClick={() => {
              setPicked(d);
              setShowEarlier(false);
            }}
          >
            {dayChipLabel(d, lang)}
          </button>
        ))}
      </div>
      {differentZone && <p className="tz-caption">{t("tzCaption", { city: cityOfZone(timeZone), zone: timeZone })}</p>}

      {hero && (
        <div className="hero" data-state={running ? "now" : "next"}>
          <div className="hero-head">
            <span className={"pill " + (running ? "now" : "next")}>{running ? t("sNow") : t("sNext")}</span>
            {heroSub && <small>{heroSub}</small>}
          </div>
          <div className="hero-title">{hero.title}</div>
          <div className="hero-meta">
            {clock(hero.startMs)} – {clock(hero.endMs)}
          </div>
          {hero.description && <p className="ses-desc">{hero.description}</p>}
          {running ? (
            <div className="prog" aria-hidden="true">
              <i style={{ width: `${pct}%` }} />
            </div>
          ) : (
            <div className="prog-gap" />
          )}
          <AddToCalendar input={calInput(hero)} variant="primary" />
        </div>
      )}

      {rest.length > 0 && (
        <>
          <p className="minihead">{running ? t("sNext") : t("sLater")}</p>
          <ul className="alist">
            {rest.map((s) => (
              <li key={s.id}>
                <span className="tm">
                  {clock(s.startMs)}
                  <small>{clock(s.endMs)}</small>
                </span>
                <span className="nm">
                  {s.title}
                  {s.description && <small className="ses-desc">{s.description}</small>}
                </span>
                <AddToCalendar input={calInput(s)} variant="icon" />
              </li>
            ))}
          </ul>
        </>
      )}

      {past.length > 0 && (
        <>
          {hero && (
            <button type="button" className="disclose" aria-expanded={showEarlier} onClick={() => setShowEarlier((v) => !v)}>
              {t("sEarlier", { n: past.length })}
              <svg className="ln" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style={{ transform: showEarlier ? "rotate(180deg)" : undefined }}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          )}
          {(showEarlier || !hero) && (
            <ul className="alist past">
              {past.map((s) => (
                <li key={s.id}>
                  <span className="tm">
                    {clock(s.startMs)}
                    <small>{clock(s.endMs)}</small>
                  </span>
                  <span className="nm">{s.title}</span>
                  <span className="pill ended">{t("sEnded")}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
