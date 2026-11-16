import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { getEvent, getPreview } from "../../../api/panelEvents";
import { safeVariants } from "../../../api/mapBundle";
import { useI18n } from "../../../i18n/I18nProvider";
import { Link, navigate } from "../../../lib/router";
import { LogoMark } from "../../../markers/Pixel";
import PointSheet from "../../../components/PointSheet";
import { AboutCover } from "../../../components/CoverMedia";
import { AboutRows } from "./About";
import { Ic, LoadError, Loading, PanelNotFound, dateRange, useDocTitle } from "./common";
import type { EventPreviewResponse } from "@atlas/contract";

const MapViewer = lazy(() => import("../../../components/MapViewer"));

/**
 * /panel/events/:id/preview: the event as visitors will see it: the uploaded map, or "Map coming soon" while there is none. A /panel route, so
 * noindex and no-store. The band is not dismissible; there is no visitor language switch. Share only when published.
 */
export default function EventPreview({ id }: { id: string }) {
  const { t } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"loading" | "error" | "missing" | EventPreviewResponse>("loading");
  // Event status, null until known (the bar shows no notice meanwhile). Share only when published.
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setState("loading");
    setStatus(null);
    getEvent(id, ctrl.signal)
      .then((r) => r.status === "ok" && setStatus(r.event.status))
      .catch(() => {});
    getPreview(id, ctrl.signal)
      .then((r) => {
        if (r.status === "unauthenticated") navigate("/panel/login", true, true);
        else if (r.status === "not_found") setState("missing");
        else if (r.status === "error") setState("error");
        else setState(r.preview);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [id, attempt]);

  useDocTitle(typeof state === "object" ? `${state.event.name} · ${t("appName")}` : t("appName"));

  if (state === "loading") return <Loading />;
  if (state === "error") return <LoadError onRetry={() => setAttempt((n) => n + 1)} />;
  if (state === "missing") return <PanelNotFound />;
  return <PreviewView id={id} data={state} status={status} />;
}

function PreviewView({ id, data, status }: { id: string; data: EventPreviewResponse; status: string | null }) {
  const { t } = useI18n();
  const published = status === "published";
  // Until the status is known: no notice, no stripes. Published is neutral; every other status keeps the striped bar.
  const [long, short] = !status ? ["", ""]
    : published ? [t("pePvPubBanner"), t("pePvPubShort")]
    : status === "in_review" ? [t("pePvReviewBanner"), t("peStReview")]
    : status === "rejected" ? [t("pePvRejBanner"), t("peStRejected")]
    : [t("pePvBanner"), t("pePvDraft")];
  return (
    <div className="pe-pv">
      <div className={!status || published ? "pe-pvbar pub" : "pe-pvbar"} role="region" aria-label={long || undefined}>
        <Link to={`/panel/events/${id}`} className="btn sm ghost" aria-label={t("pePvBack")}><Ic n="left" size={16} /><span className="lbl-dk">{t("pePvBack")}</span></Link>
        <Ic n="eye" />
        <b><span className="pv-long">{long}</span><span className="pv-short" aria-hidden="true">{short}</span></b>
        <Link to={`/panel/events/${id}/edit`} className="btn sm" aria-label={t("peEdit")}><Ic n="pencil" size={16} /><span className="lbl-dk">{t("peEdit")}</span></Link>
      </div>
      <PreviewStage data={data} canShare={published} />
    </div>
  );
}

/** The event as visitors see it, read-only. Also used by the Admin review screen (no edit controls here). */
export function PreviewStage({ data, canShare = false }: { data: EventPreviewResponse; canShare?: boolean }) {
  const { t, lang } = useI18n();
  const e = data.event;
  const points = data.points;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = points.find((p) => p.id === selectedId) ?? null;
  // Same localized category label the visitors get (a Point without a custom name is shown as this label).
  const categoryLabel = useCallback((c: string) => t(`cat_${c}` as any), [t]);
  const uid = useId().replace(/:/g, "");
  const map = data.map;
  const variants = useMemo(() => (map ? safeVariants(map.image.variants) : []), [map]);
  const mapUrl = variants[0]?.url ?? null;
  // The sheet opens by itself while there is no map; with a map the map comes first.
  const [open, setOpen] = useState(!mapUrl);
  const infoBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        setOpen(false);
        infoBtn.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
      <div className="pe-pvstage">
        <div className="pe-topbar">
          <LogoMark size={30} />
          <div className="pe-topbar-title" dir="auto" lang={e.language}>
            <h1>{e.name}</h1>
            <small>{[dateRange(e.startDate, e.endDate, lang), e.city].filter(Boolean).join(" · ")}</small>
          </div>
          <button
            ref={infoBtn}
            type="button"
            className="icon-btn"
            aria-expanded={open}
            aria-controls={`${uid}-about`}
            aria-label={t("pePvInfo")}
            onClick={() => setOpen((o) => !o)}
          >
            <Ic n="info" size={22} />
          </button>
        </div>
        {map && mapUrl ? (
          <div className="pe-pvmap" data-theme={map.theme}>
            <Suspense fallback={<div className="map-status" role="status">{t("loading")}</div>}>
              <MapViewer
                imageUrl={mapUrl}
                variants={variants}
                width={map.width}
                height={map.height}
                points={points}
                theme={map.theme}
                selectedId={selectedId}
                onSelect={setSelectedId}
                focusRequest={null}
                categoryLabel={categoryLabel}
              />
            </Suspense>
            {selected && <PointSheet point={selected} onClose={() => setSelectedId(null)} />}
          </div>
        ) : (
          <div className="pe-soon">
            <div className="tilebox">
              <Ic n="map" size={36} />
              <h2>{t("pePvMapSoon")}</h2>
              <p>{t("pePvMapText")}</p>
            </div>
          </div>
        )}
        {open && (
          <section className="pe-about" id={`${uid}-about`} role="dialog" aria-label={t("pePvAbout")}>
            <AboutCover cover={e.cover} tone={e.tone} />
            <div className="pe-ahead">
              <span className="pe-eyebrow">{t("pePvAbout")}</span>
              <button type="button" className="icon-btn" aria-label={t("close")} onClick={() => { setOpen(false); infoBtn.current?.focus(); }}>
                <Ic n="x" />
              </button>
            </div>
            <h2 dir="auto" lang={e.language}>{e.name}</h2>
            <AboutRows
              start={e.startDate}
              end={e.endDate}
              timeZone={e.timeZone}
              city={e.city}
              country={e.country}
              venueAddress={e.venueAddress}
              description={e.description}
              website={e.website}
              language={e.language}
              linkWebsite
              share={canShare ? { slug: e.slug, name: e.name } : null}
            />
          </section>
        )}
      </div>
  );
}
