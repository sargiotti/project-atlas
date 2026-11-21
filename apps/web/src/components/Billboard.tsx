import { useCallback, useEffect, useRef, useState } from "react";
import { PLACES, placeIdSchema, slugSchema, type Billboard as BillboardData, type BillboardEvent, type PlaceId } from "@atlas/contract";
import { fetchBillboard, loadPlace, storePlace } from "../api/billboard";
import { countryName, formatEventDates } from "../lib/events";
import { Link } from "../lib/router";
import { useI18n } from "../i18n/I18nProvider";
import { CoverMedia } from "./CoverMedia";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ok"; data: BillboardData };

const MARK_ROWS = ["..XXXXXX..", ".XXXXXXXX.", "XXXXXXXXXX", "XXXOOOOXXX", "XXXOOOOXXX", "XXXXXXXXXX", ".XXXXXXXX.", "..XXXXXX..", "...XXXX...", "....XX...."];
// The brand pin with explicit colours (the pill, the trail pin and the CTA sit on fixed backgrounds).
function PinMark({ size, body = "#FF6A3D", win = "#1E2340" }: { size: number; body?: string; win?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {MARK_ROWS.flatMap((row, y) =>
        [...row].map((c, x) => (c === "." ? null : <rect key={`${x}-${y}`} x={x * 8} y={y * 8} width="8" height="8" fill={c === "O" ? win : body} />)),
      )}
    </svg>
  );
}

const utc = (d: string) => new Date(`${d}T00:00:00Z`);

function dateTile(start: string, end: string, lang: string) {
  const mon = new Intl.DateTimeFormat(lang, { month: "short", timeZone: "UTC" });
  const s = utc(start);
  const e = utc(end);
  let to = "";
  if (start !== end) to = s.getUTCMonth() === e.getUTCMonth() ? `→ ${e.getUTCDate()}` : `→ ${e.getUTCDate()} ${mon.format(e).replace(".", "")}`;
  return { mo: mon.format(s).replace(".", ""), d: s.getUTCDate(), to };
}

function Poster({ event }: { event: BillboardEvent }) {
  const { t, lang } = useI18n();
  const tile = dateTile(event.startDate, event.endDate, lang);
  // The slug is contract-validated already; re-checking keeps the href safe even if that ever changes.
  const href = slugSchema.safeParse(event.slug).success ? `/e/${event.slug}` : "/";
  const city = `${event.city}, ${countryName(event.country, lang)}`;
  const label =
    t("bbCardLabel", { name: event.name, dates: formatEventDates(event.startDate, event.endDate, lang), city }) +
    (event.nearby ? `, ${t("bbNearYou")}` : "") +
    (event.isDemo ? `, ${t("bbExample")}` : "");
  return (
    <Link to={href} className="pp p1" aria-label={label}>
      <span className="pp-media"><CoverMedia cover={event.cover} tone={event.tone} size="card" /></span>
      <span className="pp-dt" aria-hidden="true">
        <span className="mo">{tile.mo}</span>
        <span className="d">{tile.d}</span>
        {tile.to && <span className="to">{tile.to}</span>}
      </span>
      {event.isDemo && <span className="pp-ex" aria-hidden="true">{t("bbExample")}</span>}
      <span className="pp-bt" aria-hidden="true">
        {event.nearby && <span className="pp-near"><PinMark size={13} body="#1E2340" win="#FF6A3D" />{t("bbNearYou")}</span>}
        <span className="pp-name">{event.name}</span>
        <span className="pp-city">{city}</span>
      </span>
    </Link>
  );
}

function CtaCard({ solo }: { solo: boolean }) {
  const { t } = useI18n();
  return (
    <Link to="/organizadores" className={`pp cta${solo ? " solo" : ""}`}>
      <span className="cta-trail" aria-hidden="true" />
      <span className="cta-px" aria-hidden="true"><PinMark size={64} body="#1E2340" win="#FAF6EF" /></span>
      <span className="cta-t">{solo ? t("bbCtaFirst") : t("bbCtaTitle")}</span>
      <span className="cta-go">{t("bbCtaButton")} <span aria-hidden="true">→</span></span>
    </Link>
  );
}

function PlaceSelect({ place, onChange }: { place: PlaceId | null; onChange: (p: PlaceId | null) => void }) {
  const { t, lang } = useI18n();
  return (
    <label className="bb-place">
      <span className="sr-only">{t("bbPlaceLabel")}. {t("bbPlaceHint")}</span>
      <span className="bb-place-k" aria-hidden="true">{t("bbNear")}:</span>
      <select
        value={place ?? ""}
        onChange={(e) => {
          // Only ids from the contract list are accepted; anything else means "your area".
          const r = placeIdSchema.safeParse(e.target.value);
          onChange(r.success ? r.data : null);
        }}
      >
        <option value="">{t("bbPlaceAuto")}</option>
        {PLACES.map((p) => <option key={p.id} value={p.id}>{p.names[lang]}</option>)}
      </select>
      <svg className="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" /></svg>
    </label>
  );
}

const reduceMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

export function Billboard() {
  const { t, lang } = useI18n();
  const [place, setPlace] = useState<PlaceId | null>(() => loadPlace());
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  // One request per selection: the previous one is aborted when the place changes. Old posters stay while it loads.
  useEffect(() => {
    const ctl = new AbortController();
    fetchBillboard(place, ctl.signal).then(
      (r) => setState((s) => (r.status === "ok" ? { kind: "ok", data: r.billboard } : s.kind === "ok" ? s : { kind: "error" })),
      () => {}, // aborted
    );
    return () => ctl.abort();
  }, [place, attempt]);

  const choose = (p: PlaceId | null) => {
    setPlace(p);
    storePlace(p);
  };
  const retry = () => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  };

  const windows = state.kind === "ok" ? state.data.windows : [];
  const total = windows.reduce((n, w) => n + w.events.length, 0);
  const anyNear = windows.some((w) => w.events.some((e) => e.nearby));
  const placeName = place ? PLACES.find((p) => p.id === place)?.names[lang] : undefined;

  // ---- N1 pixel trail: segments jump, the pin follows the rail scroll ----
  const railRef = useRef<HTMLUListElement>(null);
  const segsRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLSpanElement>(null);
  const [cur, setCur] = useState(0);
  const [overflow, setOverflow] = useState(false);
  const [edge, setEdge] = useState({ start: true, end: false });

  const update = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const fits = rail.scrollWidth <= rail.clientWidth + 1;
    setOverflow(!fits);
    const sl = rail.scrollLeft;
    const max = rail.scrollWidth - rail.clientWidth;
    const atEnd = max > 0 && sl >= max - 2;
    setEdge((e) => (e.start === sl <= 2 && e.end === atEnd ? e : { start: sl <= 2, end: atEnd }));
    const heads = Array.from(rail.querySelectorAll<HTMLElement>("[data-win]"));
    const btns = Array.from(segsRef.current?.querySelectorAll<HTMLElement>("[data-seg]") ?? []);
    const pin = pinRef.current;
    if (!heads.length || heads.length !== btns.length || !pin) return;
    if (fits) {
      // Everything is visible at once: no active segment, segments only jump.
      setCur(-1);
      pin.style.visibility = "hidden";
      return;
    }
    pin.style.visibility = "visible";
    const base = heads[0].offsetLeft;
    const starts = heads.map((h) => h.offsetLeft - base);
    const cta = rail.querySelector<HTMLElement>("[data-cta]");
    const endAll = (cta ? cta.offsetLeft : rail.scrollWidth) - base;
    let idx = 0;
    starts.forEach((s, i) => {
      if (s + base - sl <= 48) idx = i;
    });
    if (atEnd) idx = starts.length - 1;
    const a = starts[idx];
    const b = idx + 1 < starts.length ? starts[idx + 1] : endAll;
    const prog = atEnd ? 1 : Math.min(1, Math.max(0, (sl - a) / Math.max(1, b - a)));
    pin.style.left = `${btns[idx].offsetLeft + prog * btns[idx].offsetWidth}px`;
    setCur(idx);
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    rail.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(on) : null;
    ro?.observe(rail);
    return () => {
      cancelAnimationFrame(raf);
      rail.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      ro?.disconnect();
    };
  }, [update, state, lang]);

  const jump = (i: number) => {
    const rail = railRef.current;
    const heads = rail ? Array.from(rail.querySelectorAll<HTMLElement>("[data-win]")) : [];
    if (!rail || !heads[i]) return;
    rail.scrollTo?.({ left: heads[i].offsetLeft - heads[0].offsetLeft, behavior: reduceMotion() ? "auto" : "smooth" });
  };
  const step = (dir: 1 | -1) => {
    const rail = railRef.current;
    rail?.scrollBy?.({ left: dir * rail.clientWidth * 0.8, behavior: reduceMotion() ? "auto" : "smooth" });
  };

  const windowLabel = (id: string) => t(id === "now" ? "bbNow" : id === "weekend" ? "bbWeekend" : "bbLater");
  const loading = state.kind === "loading";

  return (
    <section className="bb" aria-labelledby="bb-title" aria-busy={loading}>
      <div className="bb-h">
        <h2 id="bb-title" className="bb-t">{t("bbTitle")}</h2>
        <PlaceSelect place={place} onChange={choose} />
      </div>
      {state.kind === "ok" && total > 0 && !anyNear && (
        <p className="bb-none">{placeName ? t("bbNonePlace", { place: placeName }) : t("bbNone")}</p>
      )}
      {loading && <p className="sr-only" role="status">{t("bbLoading")}</p>}
      {state.kind === "error" && (
        <p className="bb-err">
          <span>{t("bbError")}</span> <button type="button" className="btn" onClick={retry}>{t("retry")}</button>
        </p>
      )}
      {windows.length > 0 && (
        <nav className="bb-nav" aria-label={t("bbNav")}>
          <div className="bb-segs" ref={segsRef}>
            {windows.map((w, i) => (
              <button
                key={w.id}
                type="button"
                data-seg={w.id}
                className="bb-seg"
                aria-current={cur === i ? "true" : undefined}
                style={{ ["--g" as any]: w.events.length }}
                onClick={() => jump(i)}
              >
                <span className="lb">{windowLabel(w.id)} <i>{w.events.length}</i></span>
                <span className="tl" />
              </button>
            ))}
            <span className="bb-pin" ref={pinRef} aria-hidden="true"><PinMark size={16} /></span>
          </div>
          {overflow && (
            <span className="bb-arrows">
              <button type="button" className="bb-arrow" aria-label={t("bbPrev")} disabled={edge.start} onClick={() => step(-1)}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" /></svg>
              </button>
              <button type="button" className="bb-arrow" aria-label={t("bbNext")} disabled={edge.end} onClick={() => step(1)}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
              </button>
            </span>
          )}
        </nav>
      )}
      {loading ? (
        <ul className="rail" aria-hidden="true">
          {[0, 1, 2].map((i) => <li key={i} className="pp p1 sk" />)}
        </ul>
      ) : state.kind === "error" ? null : (
        <ul className="rail" ref={railRef}>
          {windows.flatMap((w) =>
            w.events.map((e, i) => (
              <li key={e.slug} data-win={i === 0 ? w.id : undefined}>
                <Poster event={e} />
              </li>
            )),
          )}
          <li data-cta><CtaCard solo={total === 0} /></li>
        </ul>
      )}
    </section>
  );
}
