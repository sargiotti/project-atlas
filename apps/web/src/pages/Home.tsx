import { useCallback, useEffect, useMemo, useState } from "react";
import { slugSchema, type EventSummary } from "@atlas/contract";
import { fetchEvents } from "../api/events";
import { countryName, formatEventDates, isEnded, localToday, sortEvents } from "../lib/events";
import { Link } from "../lib/router";
import { useI18n } from "../i18n/I18nProvider";
import { LogoMark } from "../markers/Pixel";
import { Shell } from "./Pages";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ok"; events: EventSummary[] };

function EventCard({ event, index, today }: { event: EventSummary; index: number; today: string }) {
  const { t, lang } = useI18n();
  const ended = isEnded(event, today);
  // The slug is contract-validated already; re-checking keeps the href safe even if that ever changes.
  const href = slugSchema.safeParse(event.slug).success ? `/e/${event.slug}` : "/";
  return (
    <li>
      <Link to={href} className={`ecard${ended ? " is-ended" : ""}`}>
        <div className={`ecard-media${event.cover ? "" : " cover-fallback"}`}>
          {event.cover ? (
            <img
              className="ecard-cover"
              src={event.cover.url}
              width={event.cover.width}
              height={event.cover.height}
              alt=""
              loading={index < 2 ? "eager" : "lazy"}
              decoding="async"
            />
          ) : (
            <LogoMark size={56} />
          )}
          {ended && <span className="ended-badge" aria-hidden="true">{t("ended")}</span>}
        </div>
        <div className="ecard-body">
          <h3 className="ecard-name">{event.name}</h3>
          <p className="meta">{formatEventDates(event.startDate, event.endDate, lang)}</p>
          <p className="meta">{`${event.city}, ${countryName(event.country, lang)}`}</p>
          {ended && <span className="sr-only">{t("ended")}</span>}
        </div>
      </Link>
    </li>
  );
}

function Skeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <li key={i} className="sk-card" aria-hidden="true">
          <div className="sk sk-cover" />
          <div className="sk-body">
            <div className="sk sk-line w80" />
            <div className="sk sk-line w50" />
            <div className="sk sk-line w40" />
          </div>
        </li>
      ))}
    </>
  );
}

export default function Home() {
  const { t, lang } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    fetchEvents(ctl.signal).then(
      (r) => setState(r.status === "ok" ? { kind: "ok", events: r.events } : { kind: "error" }),
      () => {}, // aborted
    );
    return () => ctl.abort();
  }, [attempt]);

  // Retry happens only on an explicit click: no timers, no automatic loops.
  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  const today = useMemo(() => localToday(), []);
  const sorted = useMemo(() => (state.kind === "ok" ? sortEvents(state.events, today) : []), [state, today]);

  return (
    <Shell wide>
      <h1 className="h-tagline" lang={lang === "en" ? undefined : "en"}>Find <span className="h-tagline-em">your</span> way</h1>
      <h2 className="section-title">{t("events")}</h2>
      {state.kind === "loading" && (
        <>
          <p className="sr-only" role="status">{t("loadingEvents")}</p>
          <ul className="cards" aria-busy="true"><Skeleton /></ul>
        </>
      )}
      {state.kind === "error" && (
        <div className="state" role="alert">
          <svg className="state-ico" viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
            <path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0" />
            <path d="M3 3l18 18" />
          </svg>
          <h2>{t("errorTitle")}</h2>
          <p className="muted">{t("errorText")}</p>
          <button type="button" className="btn primary" onClick={retry}>{t("retry")}</button>
        </div>
      )}
      {state.kind === "ok" && sorted.length === 0 && (
        <div className="state">
          <LogoMark size={56} />
          <h2>{t("emptyTitle")}</h2>
          <p className="muted">{t("emptyText")}</p>
        </div>
      )}
      {state.kind === "ok" && sorted.length > 0 && (
        <ul className="cards">
          {sorted.map((e, i) => <EventCard key={e.slug} event={e} index={i} today={today} />)}
        </ul>
      )}
    </Shell>
  );
}
