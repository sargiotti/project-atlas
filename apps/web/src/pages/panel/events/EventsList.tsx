import { useEffect, useMemo, useState } from "react";
import { MAX_EVENTS_PER_ORGANIZER, TONE_FILLS, toneOf, type PanelEvent } from "@atlas/contract";
import { listEvents } from "../../../api/panelEvents";
import { useI18n } from "../../../i18n/I18nProvider";
import { CoverMedia } from "../../../components/CoverMedia";
import { Link, navigate } from "../../../lib/router";
import { DayTile, Ic, LoadError, Loading, StatusBadge, Toast, dateRange, pastel, useDocTitle, useFlashToast } from "./common";

/** Quest-trail art for the empty panel: a tiny pixel map, drawn as SVG rects. */
function QuestArt() {
  const W = 24, H = 17;
  const g: string[][] = Array.from({ length: H }, () => Array(W).fill(""));
  const C: Record<string, string> = { k: "#3A2C78", y: "#F4F0CC", F: "#A39C3E", Y: "#DCD58A", D: "#6f55c8", L: "#b5db7a", l: "#7fae45" };
  for (let r = 5; r < H; r++)
    for (let c = 0; c < W; c++) g[r][c] = r === 5 || r === H - 1 || c === 0 || c === W - 1 ? "k" : c === 8 || c === 16 ? "F" : c > 8 && c < 16 ? "Y" : "y";
  for (const [c, r] of [[2, 14], [3, 14], [5, 13], [6, 13], [7, 12], [9, 12], [10, 12], [11, 11], [12, 11], [13, 11]]) g[r][c] = "D";
  for (let r = 0; r <= 11; r++) g[r][15] = "k";
  g[11][14] = "k";
  g[11][16] = "k";
  for (let c = 16; c <= 20; c++) { g[0][c] = "k"; g[4][c] = "k"; g[1][c] = "L"; g[3][c] = c < 19 ? "l" : "L"; }
  for (let c = 16; c <= 21; c++) g[2][c] = "L";
  g[1][21] = "k"; g[2][22] = "k"; g[3][21] = "k";
  return (
    <svg className="px" width={W * 12} height={H * 12} viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {g.flatMap((row, r) => row.map((c, x) => (c ? <rect key={`${r}-${x}`} x={x} y={r} width="1" height="1" fill={C[c]} /> : null)))}
    </svg>
  );
}

/** /panel: the organizer's events (all drafts in this slice), or the empty "quest" state. */
export default function EventsList() {
  const { t, lang } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const [events, setEvents] = useState<PanelEvent[] | "loading" | "error">("loading");
  const { toast, clearToast } = useFlashToast();
  useDocTitle(`${t("myEvents")} · ${t("appName")}`);

  useEffect(() => {
    const ctrl = new AbortController();
    setEvents("loading");
    listEvents(ctrl.signal)
      .then((r) => {
        if (r.status === "unauthenticated") navigate("/panel/login", true, true);
        else if (r.status === "ok") setEvents(r.events);
        else setEvents("error");
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [attempt]);

  const sorted = useMemo(
    () => (Array.isArray(events) ? [...events].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name)) : []),
    [events],
  );

  if (events === "loading") return <Loading />;
  if (events === "error") return <LoadError onRetry={() => setAttempt((n) => n + 1)} />;

  const n = sorted.length;
  if (n === 0) {
    return (
      <div className="pe-page">
        <section className="pe-hero">
          <div className="art"><QuestArt /></div>
          <div className="txt">
            <p className="pe-eyebrow">{t("peEmptyEyebrow")}</p>
            <h1>{t("peEmptyTitle")}</h1>
            <p className="lead">{t("peEmptyText")}</p>
            <Link to="/panel/events/new" className="btn primary lg"><Ic n="plus" />{t("peEmptyCta")}</Link>
            <span className="time"><Ic n="clock" size={16} />{t("peEmptyTime")}</span>
          </div>
        </section>
        <ol className="pe-path3" aria-label={t("pePathTitle")}>
          <li className="now"><span className="node">1</span><div><b>{t("peStep1")}</b><small>{t("peStep1Now")}</small></div></li>
          <li className="tile" style={{ "--pf": TONE_FILLS[0] } as any}><span className="node">2</span><div><b>{t("peStep2")}</b><small>{t("peStep2S")}</small></div></li>
          <li className="later"><span className="node">3</span><div><b>{t("peStep3")}</b><small>{t("peStep3S")}</small></div></li>
        </ol>
        {toast && <Toast text={toast} onDone={clearToast} />}
      </div>
    );
  }

  const footer = (e: PanelEvent) =>
    e.status === "draft"
      ? e.map ? t("peFootReady") : t("peNeedsMap")
      : e.status === "in_review" ? t("peFootReview")
      : e.status === "published" ? t("peFootPublished")
      : e.status === "rejected" ? t("peFootRejected")
      : t("peFootUnpub");

  const full = n >= MAX_EVENTS_PER_ORGANIZER;
  return (
    <div className="pe-page">
      <div className="pe-lband">
        <div>
          <h1>{t("myEvents")}</h1>
          <div className="pe-meter">
            <span className="dots" aria-hidden="true">
              {Array.from({ length: MAX_EVENTS_PER_ORGANIZER }, (_, i) => <i key={i} className={i < n ? "on" : ""} />)}
            </span>
            <span>{t("peCount", { n })}</span>
          </div>
        </div>
        {full ? (
          <div className="pe-limitchip" role="note">
            <Ic n="lock" size={22} />
            <div><b>{t("peLimitTitle")}</b><span>{t("peLimitText")}</span></div>
          </div>
        ) : (
          <Link to="/panel/events/new" className="btn primary lg"><Ic n="plus" />{t("peCreate")}</Link>
        )}
      </div>
      <ul className="pe-egrid">
        {sorted.map((e) => (
          <li key={e.id}>
            <article className="pe-ecard">
              <div className={`pe-cover${e.cover ? " img" : ""}`} style={pastel(e.id)}>
                {e.cover && <CoverMedia cover={e.cover} tone={toneOf(e.id)} size="card" imgClassName="cv-fill" />}
                <DayTile start={e.startDate} />
              </div>
              <div className="pe-quick">
                <Link to={`/panel/events/${e.id}/preview`} className="icon-btn" aria-label={t("pePreviewOf", { n: e.name })} title={t("pePreview")}><Ic n="eye" /></Link>
                <Link to={`/panel/events/${e.id}/edit`} className="icon-btn" aria-label={t("peEditOf", { n: e.name })} title={t("peEdit")}><Ic n="pencil" /></Link>
              </div>
              <div className="pe-ebody">
                <StatusBadge status={e.status} />
                <h2 dir="auto"><Link to={`/panel/events/${e.id}`}>{e.name}</Link></h2>
                <p className="pe-meta" dir="auto">{dateRange(e.startDate, e.endDate, lang)} · {e.city}</p>
                <p className={`pe-efoot${e.status === "rejected" || e.status === "unpublished_admin" || (e.status === "draft" && e.map) ? " hot" : ""}`}>
                  <Ic n={e.status === "draft" && !e.map ? "map" : e.status === "published" ? "globe" : e.status === "in_review" ? "clock" : e.status === "draft" ? "check" : "warn"} size={16} />
                  {footer(e)}
                </p>
              </div>
            </article>
          </li>
        ))}
        {!full && (
          <li>
            <Link to="/panel/events/new" className="pe-ghostcard" aria-hidden="true" tabIndex={-1}>
              <span className="plus"><Ic n="plus" size={26} /></span>
              {t("peCreate")}
            </Link>
          </li>
        )}
      </ul>
      {toast && <Toast text={toast} onDone={clearToast} />}
    </div>
  );
}
