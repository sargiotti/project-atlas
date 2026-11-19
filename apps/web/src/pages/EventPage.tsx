import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapBundle } from "@atlas/contract";
import { fetchMapBundle, safeVariants, type BundleResult } from "../api/mapBundle";
import { useI18n } from "../i18n/I18nProvider";
import LangSwitch from "../components/LangSwitch";
import PointList from "../components/PointList";
import PointSheet from "../components/PointSheet";
import ScheduleView, { ScheduleBoundary } from "../components/ScheduleView";
import ShareDialog from "../components/ShareDialog";
import { LogoMark } from "../markers/Pixel";
import { Link } from "../lib/router";
import { parseAt, withTimes, type TimedSession } from "../lib/schedule";
import { EventGone, Loading, Unavailable } from "./Pages";
import { EventPrivacyLink } from "../components/PrivacyLink";
import MapIntroHint from "../components/MapIntroHint";

// The map viewer (gestures + marker art) is the heavy part: load it only on event pages.
const MapViewer = lazy(() => import("../components/MapViewer"));
// The About sheet shares the organizer-preview rows (and their CSS): only fetched when a visitor taps (i).
const AboutSheet = lazy(() => import("../components/AboutSheet"));

function formatDates(start: string, end: string, lang: string) {
  try {
    const f = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    const a = new Date(`${start}T00:00:00Z`);
    const b = new Date(`${end}T00:00:00Z`);
    return start === end ? f.format(a) : f.formatRange(a, b);
  } catch {
    return start === end ? start : `${start} – ${end}`;
  }
}

function ScheduleFailed() {
  const { t } = useI18n();
  return (
    <p className="sched-empty" role="alert">
      {t("schError")}
    </p>
  );
}

export default function EventPage({ slug }: { slug: string }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<BundleResult | null>(null);
  // The organizer can replace a published map, which deletes the old image: refetch the bundle once.
  const refetched = useRef(false);

  useEffect(() => {
    refetched.current = false;
    const ctrl = new AbortController();
    setResult(null);
    fetchMapBundle(slug, ctrl.signal)
      .then(setResult)
      .catch(() => {}); // aborted
    return () => ctrl.abort();
  }, [slug, attempt]);

  if (!result) return <Loading />;
  if (result.status === "not-found") return <EventGone />;
  if (result.status === "unavailable") return <Unavailable onRetry={() => setAttempt((n) => n + 1)} />;
  const onImageError = () => {
    if (refetched.current) return;
    refetched.current = true;
    fetchMapBundle(slug)
      .then((r) => (r.status === "ok" || r.status === "not-found") && setResult(r))
      .catch(() => {});
  };
  return <EventView bundle={result.bundle} imageUrl={result.imageUrl} onImageError={onImageError} />;
}

function EventView({ bundle, imageUrl, onImageError }: { bundle: MapBundle; imageUrl: string; onImageError: () => void }) {
  const { t, lang } = useI18n();
  const { event, map, points, sessions } = bundle;
  const variants = useMemo(() => safeVariants(map.image.variants), [map.image.variants]);
  const [view, setView] = useState<"map" | "list" | "schedule">("map");
  const [scheduleSeen, setScheduleSeen] = useState(false);
  // Slice 10: the Session whose block was tapped in the grid; the sheet opens on its day with it outlined.
  const [focus, setFocus] = useState<{ sessionId: string; day: string; nonce: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const infoBtn = useRef<HTMLButtonElement>(null);
  const closeAbout = () => {
    setAboutOpen(false);
    infoBtn.current?.focus();
  };
  const selected = useMemo(() => points.find((p) => p.id === selectedId) ?? null, [points, selectedId]);
  // Slice 09: sessions grouped by Point. `?at=` only changes what "now" means while rendering.
  const timed = useMemo(() => withTimes(sessions, event.timeZone, event.dayStart), [sessions, event.timeZone, event.dayStart]);
  const sessionsByPoint = useMemo(() => {
    const m = new Map<string, TimedSession[]>();
    for (const s of timed) m.set(s.pointId, [...(m.get(s.pointId) ?? []), s]);
    return m;
  }, [timed]);
  const hasSchedule = timed.length > 0;
  const atMs = useMemo(() => parseAt(window.location.search, event.timeZone), [event.timeZone]);

  useEffect(() => {
    const prev = document.title;
    document.title = `${event.name} · ${t("appName")}`;
    return () => {
      document.title = prev;
    };
  }, [event.name, t]);

  const categoryLabel = useCallback((c: string) => t(`cat_${c}` as any), [t]);

  const showView = (v: "map" | "list" | "schedule") => {
    if (v === "schedule") {
      setScheduleSeen(true);
      // A sheet left over from the map would hide the view switch on phones: start the grid clean.
      setSelectedId(null);
      setFocus(null);
    }
    setView(v);
  };
  const selectPoint = (id: string | null) => {
    setSelectedId(id);
    setFocus(null);
  };
  const pickSession = (s: TimedSession) => {
    setSelectedId(s.pointId); // from the bundle, never from the URL
    setFocus((f) => ({ sessionId: s.id, day: s.day, nonce: (f?.nonce ?? 0) + 1 }));
  };
  const seeOnMap = () => {
    if (!selectedId) return;
    setView("map");
    setFocusRequest((r) => ({ id: selectedId, nonce: (r?.nonce ?? 0) + 1 }));
  };

  const pickFromList = (id: string) => {
    setView("map");
    setSelectedId(id);
    setFocusRequest((r) => ({ id, nonce: (r?.nonce ?? 0) + 1 }));
  };

  return (
    <div className={`app event-page v-${view}${selected && view !== "list" ? " sheet-open" : ""}`} data-theme={map.theme}>
      <div className="stage" aria-hidden={shareOpen || undefined}>
        <div className="view-pane" hidden={view !== "map"}>
          <Suspense fallback={<div className="map-status" role="status">{t("loading")}</div>}>
            <MapViewer
              imageUrl={imageUrl}
              variants={variants}
              width={map.width}
              height={map.height}
              points={points}
              theme={map.theme}
              selectedId={selectedId}
              onSelect={selectPoint}
              focusRequest={focusRequest}
              categoryLabel={categoryLabel}
              clusters
              onImageError={onImageError}
              onImageLoaded={() => setMapLoaded(true)}
            />
          </Suspense>
        </div>
        <div className="view-pane list-pane" hidden={view !== "list"}>
          <PointList points={points} onPick={pickFromList} />
        </div>
        {hasSchedule && scheduleSeen && (
          <div className="view-pane schedule-pane" hidden={view !== "schedule"}>
            <ScheduleBoundary fallback={<ScheduleFailed />}>
              <ScheduleView
                active={view === "schedule"}
                event={event}
                points={points}
                sessions={timed}
                atMs={atMs}
                selectedSessionId={focus && selected ? focus.sessionId : null}
                sheetOpen={!!selected && view === "schedule"}
                revealNonce={focus?.nonce ?? 0}
                onPickSession={pickSession}
              />
            </ScheduleBoundary>
          </div>
        )}
      </div>

      <header className="topbar">
        <Link to="/" className="brand-mark" aria-label={t("appName")}>
          <LogoMark size={30} />
        </Link>
        <div className="topbar-title">
          <h1>{event.name}</h1>
          <small>{formatDates(event.startDate, event.endDate, lang)}</small>
        </div>
        <LangSwitch />
        <button
          ref={infoBtn}
          type="button"
          className="icon-btn"
          onClick={() => setAboutOpen((o) => !o)}
          aria-label={t("pePvInfo")}
          aria-haspopup="dialog"
          aria-expanded={aboutOpen}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v6M12 7.5v.5" />
          </svg>
        </button>
        <button type="button" className="icon-btn" onClick={() => setShareOpen(true)} aria-label={t("share")} aria-haspopup="dialog">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6" />
          </svg>
        </button>
      </header>

      {/* On phones the switch and the sheet stack in this dock, so the switch rides above the sheet. */}
      <div className="bottom-dock">
        <MapIntroHint view={view} mapLoaded={mapLoaded} sheetOpen={!!selected} hasSchedule={hasSchedule} />
        <div className="view-switch" role="group" aria-label={t("viewSwitch")}>
          <button type="button" className={view === "map" ? "on" : ""} aria-pressed={view === "map"} onClick={() => showView("map")}>
            {t("map")}
          </button>
          <button type="button" className={view === "list" ? "on" : ""} aria-pressed={view === "list"} onClick={() => showView("list")}>
            {t("list")}
          </button>
          {hasSchedule && (
            <button type="button" className={view === "schedule" ? "on" : ""} aria-pressed={view === "schedule"} onClick={() => showView("schedule")}>
              {t("schedule")}
            </button>
          )}
        </div>
        {selected && (view === "map" || view === "schedule") && (
          <PointSheet
            point={selected}
            onClose={() => selectPoint(null)}
            focus={focus}
            onSeeOnMap={view === "schedule" ? seeOnMap : undefined}
            event={event}
            sessions={sessionsByPoint.get(selected.id)}
            atMs={atMs}
          />
        )}
      </div>
      {aboutOpen && (
        <Suspense fallback={null}>
          <AboutSheet event={event} onClose={closeAbout} />
        </Suspense>
      )}
      <EventPrivacyLink />
      {shareOpen && <ShareDialog slug={event.slug} eventName={event.name} onClose={() => setShareOpen(false)} />}
    </div>
  );
}
