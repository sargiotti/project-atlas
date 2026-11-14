import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { MapBundle } from "@atlas/contract";
import { fetchMapBundle, type BundleResult } from "../api/mapBundle";
import { useI18n } from "../i18n/I18nProvider";
import LangSwitch from "../components/LangSwitch";
import PointList from "../components/PointList";
import PointSheet from "../components/PointSheet";
import ShareDialog from "../components/ShareDialog";
import { LogoMark } from "../markers/Pixel";
import { Link } from "../lib/router";
import { parseAt, withTimes, type TimedSession } from "../lib/schedule";
import { EventNotFound, Loading, Unavailable } from "./Pages";

// The map viewer (gestures + marker art) is the heavy part: load it only on event pages.
const MapViewer = lazy(() => import("../components/MapViewer"));

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

export default function EventPage({ slug }: { slug: string }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<BundleResult | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setResult(null);
    fetchMapBundle(slug, ctrl.signal)
      .then(setResult)
      .catch(() => {}); // aborted
    return () => ctrl.abort();
  }, [slug, attempt]);

  if (!result) return <Loading />;
  if (result.status === "not-found") return <EventNotFound />;
  if (result.status === "unavailable") return <Unavailable onRetry={() => setAttempt((n) => n + 1)} />;
  return <EventView bundle={result.bundle} imageUrl={result.imageUrl} />;
}

function EventView({ bundle, imageUrl }: { bundle: MapBundle; imageUrl: string }) {
  const { t, lang } = useI18n();
  const { event, map, points, sessions } = bundle;
  const [view, setView] = useState<"map" | "list">("map");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const selected = useMemo(() => points.find((p) => p.id === selectedId) ?? null, [points, selectedId]);
  // Slice 09: sessions grouped by Point. `?at=` only changes what "now" means while rendering.
  const sessionsByPoint = useMemo(() => {
    const m = new Map<string, TimedSession[]>();
    for (const s of withTimes(sessions, event.timeZone, event.dayStart)) m.set(s.pointId, [...(m.get(s.pointId) ?? []), s]);
    return m;
  }, [sessions, event.timeZone, event.dayStart]);
  const atMs = useMemo(() => parseAt(window.location.search, event.timeZone), [event.timeZone]);

  useEffect(() => {
    const prev = document.title;
    document.title = `${event.name} · ${t("appName")}`;
    return () => {
      document.title = prev;
    };
  }, [event.name, t]);

  const categoryLabel = useCallback((c: string) => t(`cat_${c}` as any), [t]);

  const pickFromList = (id: string) => {
    setView("map");
    setSelectedId(id);
    setFocusRequest((r) => ({ id, nonce: (r?.nonce ?? 0) + 1 }));
  };

  return (
    <div className="app event-page" data-theme={map.theme}>
      <div className="stage" aria-hidden={shareOpen || undefined}>
        <div className="view-pane" hidden={view !== "map"}>
          <Suspense fallback={<div className="map-status" role="status">{t("loading")}</div>}>
            <MapViewer
              imageUrl={imageUrl}
              width={map.width}
              height={map.height}
              points={points}
              theme={map.theme}
              selectedId={selectedId}
              onSelect={setSelectedId}
              focusRequest={focusRequest}
              categoryLabel={categoryLabel}
            />
          </Suspense>
        </div>
        <div className="view-pane list-pane" hidden={view !== "list"}>
          <PointList points={points} onPick={pickFromList} />
        </div>
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
        <button type="button" className="icon-btn" onClick={() => setShareOpen(true)} aria-label={t("share")} aria-haspopup="dialog">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6" />
          </svg>
        </button>
      </header>

      {/* On phones the switch and the sheet stack in this dock, so the switch rides above the sheet. */}
      <div className="bottom-dock">
        <div className="view-switch" role="group" aria-label={t("viewSwitch")}>
          <button type="button" className={view === "map" ? "on" : ""} aria-pressed={view === "map"} onClick={() => setView("map")}>
            {t("map")}
          </button>
          <button type="button" className={view === "list" ? "on" : ""} aria-pressed={view === "list"} onClick={() => setView("list")}>
            {t("list")}
          </button>
        </div>
        {selected && view === "map" && (
          <PointSheet
            point={selected}
            onClose={() => setSelectedId(null)}
            event={event}
            sessions={sessionsByPoint.get(selected.id)}
            atMs={atMs}
          />
        )}
      </div>
      {shareOpen && <ShareDialog slug={event.slug} eventName={event.name} onClose={() => setShareOpen(false)} />}
    </div>
  );
}
