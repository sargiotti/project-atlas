import { HomeTrailTile } from "../components/HomeTrailTile";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { slugSchema, type EventSummary } from "@atlas/contract";
import { fetchEvents } from "../api/events";
import { countryName, formatEventDates, isEnded, localToday, sortEvents } from "../lib/events";
import { Link } from "../lib/router";
import { matchesQuery, queryWords, SEARCH_MAX } from "../lib/search";
import { useI18n } from "../i18n/I18nProvider";
import { CoverMedia } from "../components/CoverMedia";
import { CategoryIcon, LogoMark } from "../markers/Pixel";
import { Shell } from "./Pages";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ok"; events: EventSummary[] };

function EventCard({ event, today }: { event: EventSummary; today: string }) {
  const { t, lang } = useI18n();
  const ended = isEnded(event, today);
  // The slug is contract-validated already; re-checking keeps the href safe even if that ever changes.
  const href = slugSchema.safeParse(event.slug).success ? `/e/${event.slug}` : "/";
  return (
    <li>
      <Link to={href} className={`ecard${ended ? " is-ended" : ""}`}>
        <div className="ecard-media">
          <CoverMedia cover={event.cover} tone={event.tone} size="card" imgClassName="ecard-cover" />
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

function SearchField({ query, setQuery, shown, total, inputRef }: any) {
  const { t } = useI18n();
  const [status, setStatus] = useState("");
  const active = query.trim() !== "";

  // Polite status message, updated after typing pauses so screen readers are not flooded.
  useEffect(() => {
    if (!active) {
      setStatus("");
      return;
    }
    const id = setTimeout(
      () => setStatus(shown === 0 ? t("searchNone") : shown === 1 ? t("searchFoundOne") : t("searchFound", { n: shown })),
      300,
    );
    return () => clearTimeout(id);
  }, [active, shown, t]);

  const clear = () => {
    setQuery("");
    inputRef.current?.focus();
  };
  return (
    <div className="search" role="search">
      <label htmlFor="event-search" className="sr-only">{t("searchLabel")}</label>
      <svg className="search-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input
        id="event-search"
        ref={inputRef}
        className="search-input"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={SEARCH_MAX}
        placeholder={t("searchPlaceholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value.slice(0, SEARCH_MAX))}
        onKeyDown={(e) => {
          if (e.key === "Escape" && query) {
            e.preventDefault();
            clear();
          }
        }}
      />
      {query && (
        <div className="search-tools">
          {active && <span className="search-count" aria-hidden="true">{t("searchCount", { n: shown, total })}</span>}
          <button type="button" className="icon-btn search-clear" aria-label={t("searchClear")} onClick={clear}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      )}
      <p className="sr-only" role="status">{status}</p>
    </div>
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

  // Search text lives only in this component's state: not in the URL, storage or any request.
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const words = useMemo(() => queryWords(query), [query]);
  const visible = useMemo(() => (words.length ? sorted.filter((e) => matchesQuery(e, words)) : sorted), [sorted, words]);
  const clearQuery = () => {
    setQuery("");
    inputRef.current?.focus();
  };

  return (
    <Shell wide>
      <div className="home-hero">
        <div className="home-hero-text">
          <h1 className="h-tagline" lang={lang === "en" ? undefined : "en"}>Find <span className="h-tagline-em">your</span> way</h1>
          <p className="home-hero-value"><strong className="home-hero-lead">{t("homeValueLead")}</strong> {t("homeValue")}</p>
        </div>
        <HomeTrailTile className="home-hero-tile" />
      </div>
      <Link to="/organizadores" className="org-banner">
        <CategoryIcon category="stage" size={36} />
        <span className="t"><b>{t("orgBannerT")}</b><span>{t("orgBannerP")}</span></span>
        <span className="go" aria-hidden="true">→</span>
      </Link>
      {state.kind === "ok" && sorted.length > 0 && (
        <SearchField query={query} setQuery={setQuery} shown={visible.length} total={sorted.length} inputRef={inputRef} />
      )}
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
      {state.kind === "ok" && sorted.length > 0 && visible.length === 0 && (
        <div className="state">
          <LogoMark size={56} />
          <h2 className="q">{t("noMatch")} “{query.trim()}”</h2>
          <p className="muted">{t("noMatchHint")}</p>
          <button type="button" className="btn" onClick={clearQuery}>{t("searchClear")}</button>
        </div>
      )}
      {state.kind === "ok" && visible.length > 0 && (
        <ul className="cards">
          {visible.map((e) => <EventCard key={e.slug} event={e} today={today} />)}
        </ul>
      )}
    </Shell>
  );
}
