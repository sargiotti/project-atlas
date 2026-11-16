import { useEffect, useId, useRef, useState } from "react";
import { toneOf, type PanelEvent } from "@atlas/contract";
import { CoverMedia, FallbackCover } from "../../../components/CoverMedia";
import { deleteEvent, getEvent } from "../../../api/panelEvents";
import { useI18n } from "../../../i18n/I18nProvider";
import { countryName } from "../../../lib/events";
import { daysInclusive } from "../../../lib/eventForm";
import { Link, navigate } from "../../../lib/router";
import { zoneLabel, zoneOffset } from "../../../lib/timeZones";
import { WebsiteLink } from "./About";
import MapCard from "./MapCard";
import PublishStep from "./PublishStep";
import { Dialog, DayTile, Ic, LoadError, Loading, PanelNotFound, StatusBadge, Toast, dateRange, pastel, setFlash, useDocTitle, useFlashToast } from "./common";

/** /panel/events/:id after a save: what the event looks like, how to publish it, and (quietly) delete. */
export default function EventHub({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"loading" | "error" | "missing" | PanelEvent>("loading");
  const [deleting, setDeleting] = useState(false);
  const { toast: flashToast, clearToast, banner } = useFlashToast();
  const [notice, setNotice] = useState<string | null>(null);
  const toast = notice ?? flashToast;
  const bannerRef = useRef<HTMLDivElement>(null);
  const h1 = useRef<HTMLHeadingElement>(null);
  const loaded = typeof state === "object";

  useEffect(() => {
    const ctrl = new AbortController();
    setState("loading");
    getEvent(id, ctrl.signal)
      .then((r) => {
        if (r.status === "unauthenticated") navigate("/panel/login", true, true);
        else if (r.status === "not_found") setState("missing");
        else if (r.status === "error") setState("error");
        else setState(r.event);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [id, attempt]);

  useEffect(() => {
    if (!loaded) return;
    (banner ? bannerRef.current : h1.current)?.focus();
  }, [loaded, banner]);

  useDocTitle(loaded ? `${state.name} · ${t("appName")}` : t("appName"));

  if (state === "loading") return <Loading />;
  if (state === "error") return <LoadError onRetry={() => setAttempt((n) => n + 1)} />;
  if (state === "missing") return <PanelNotFound />;
  const e = state;
  const days = daysInclusive(e.startDate, e.endDate) ?? 1;
  const label = zoneLabel(e.timeZone);

  const unset = (field: "description" | "website") => (
    <div className="pe-unset">
      {t("peNotSet")}
      <Link to={`/panel/events/${e.id}/edit?focus=${field}`} className="btn sm"><Ic n="plus" size={16} />{t("peAdd")}</Link>
    </div>
  );

  return (
    <div className="pe-page">
      <Link to="/panel" className="pe-back"><Ic n="left" size={18} />{t("myEvents")}</Link>
      {banner && (
        <div className="pe-okbanner" role="status" tabIndex={-1} ref={bannerRef}>
          <Ic n="check" />
          <b>{t("peSaved")}</b>
          <span>{t("peSavedText")}</span>
        </div>
      )}
      <div className="pe-hubgrid">
        <section className="pe-hcardw pe-hhero" aria-labelledby={`${id}-h1`}>
          <div className={`pe-cover${e.cover ? " img" : ""}`} style={pastel(e.id)}>
            {e.cover && <CoverMedia cover={e.cover} tone={toneOf(e.id)} size="full" imgClassName="cv-fill" />}
            <DayTile start={e.startDate} />
            <StatusBadge status={e.status} />
          </div>
          <div className="pe-info">
            <h1 id={`${id}-h1`} tabIndex={-1} ref={h1} dir="auto">{e.name}</h1>
            <p className="pe-meta" dir="auto">
              {dateRange(e.startDate, e.endDate, lang)} · {e.city}, {countryName(e.country, lang)}
            </p>
            <div className="pe-hacts">
              <Link to={`/panel/events/${e.id}/preview`} className="btn primary lg"><Ic n="eye" />{t("pePreview")}</Link>
              <Link to={`/panel/events/${e.id}/edit`} className="btn lg"><Ic n="pencil" />{t("peEdit")}</Link>
            </div>
          </div>
        </section>

        <MapCard
          eventId={e.id}
          map={e.map}
          onMap={(map) => setState((cur) => (typeof cur === "object" ? { ...cur, map } : cur))}
          onUnauthenticated={() => navigate("/panel/login", true, true)}
          onNotFound={() => setState("missing")}
          onReload={() => void getEvent(id).then((r) => r.status === "ok" && setState(r.event)).catch(() => {})}
        />

        {e.map && (
          <section className="pe-hcardw pe-hpoints" aria-labelledby={`${id}-pts`}>
            <h2 className="pe-ctitle" id={`${id}-pts`}><Ic n="pin" size={16} />{t("pedHubTitle")}</h2>
            <p className="pe-sub">{t("pedHubText")}</p>
            <div className="pe-brow">
              <Link to={`/panel/events/${e.id}/points`} className="btn primary"><Ic n="pin" size={18} />{t("pedHubBtn")}</Link>
            </div>
          </section>
        )}

        {e.map && (
          <section className="pe-hcardw pe-hpoints pe-hschedule" aria-labelledby={`${id}-sch`}>
            <h2 className="pe-ctitle" id={`${id}-sch`}><Ic n="cal" size={16} />{t("sedHubTitle")}</h2>
            <p className="pe-sub">{t("sedHubText")}</p>
            <div className="pe-brow">
              <Link to={`/panel/events/${e.id}/schedule`} className="btn primary"><Ic n="cal" size={18} />{t("sedHubBtn")}</Link>
            </div>
          </section>
        )}

        <section className="pe-hcardw pe-hpath">
          <h2 className="pe-ctitle">{t("pePathTitle")}</h2>
          <ol className="pe-trail">
            <li className="done"><span className="node"><Ic n="check" /></span><div><b>{t("peStep1")}</b><small>{t("peStep1Done")}</small></div></li>
            {e.map ? (
              <li className="done"><span className="node"><Ic n="check" /></span><div><b>{t("peStep2")}</b><small>{t("peStep1Done")}</small></div></li>
            ) : (
              <li className="nextstep"><span className="node">2</span><div><b>{t("peStep2")}</b><small>{t("peStep2Now")}</small></div></li>
            )}
            <PublishStep
              event={e}
              onEvent={(ev) => setState(ev)}
              onReload={() => void getEvent(id).then((r) => r.status === "ok" && setState(r.event)).catch(() => {})}
              onNotice={setNotice}
            />
          </ol>
          {!e.cover && (
            <div className="pe-sugg">
              <div className="cv-thumb" aria-hidden="true"><FallbackCover tone={toneOf(e.id)} /></div>
              <div>
                <b>{t("cvHubTitle")}<span className="tag">{t("cvOptional")}</span></b>
                <small>{t("cvHubText")}</small>
              </div>
              <Link to={`/panel/events/${e.id}/edit?focus=cover`} className="btn sm"><Ic n="plus" size={16} />{t("peAdd")}</Link>
            </div>
          )}
        </section>

        <section className="pe-hcardw pe-hwhen">
          <h2 className="pe-ctitle"><Ic n="cal" size={16} />{t("peSecWhen")}</h2>
          <p className="pe-big">{dateRange(e.startDate, e.endDate, lang)}</p>
          <p className="pe-sub">
            {days === 1 ? t("peLasts1") : t("peLastsN", { n: days })} · {label.city} ({zoneOffset(e.timeZone, new Date(`${e.startDate}T12:00:00Z`))})
          </p>
        </section>

        <section className="pe-hcardw pe-hwhere">
          <h2 className="pe-ctitle"><Ic n="pin" size={16} />{t("peSecWhere")}</h2>
          <p className="pe-big" dir="auto">{e.city}</p>
          <p className="pe-sub">{countryName(e.country, lang)}</p>
          {e.venueAddress && <p className="pe-sub pe-hvenue" dir="auto" lang={e.language}>{e.venueAddress}</p>}
        </section>

        <section className="pe-hcardw pe-habout">
          <h2 className="pe-ctitle"><Ic n="info" size={16} />{t("pePvAbout")}</h2>
          {e.description ? <div className="pe-adesc" dir="auto" lang={e.language}>{e.description}</div> : unset("description")}
          <div className="pe-webrow">
            {e.website ? (
              <span className="pe-arow flat"><Ic n="globe" size={18} /><WebsiteLink url={e.website} className="pe-alink" /></span>
            ) : (
              unset("website")
            )}
          </div>
        </section>

        <div className="pe-dz">
          <span><Ic n="trash" size={18} />{t("peDangerShort")}</span>
          <button type="button" className="btn danger sm" onClick={() => setDeleting(true)}>{t("peDelOpen")}</button>
        </div>
      </div>

      {deleting && <DeleteDialog event={e} onClose={() => setDeleting(false)} onGone={() => { setDeleting(false); setState("missing"); }} />}
      {toast && <Toast text={toast} onDone={() => { setNotice(null); clearToast(); }} />}
    </div>
  );
}

/** Exact, case-sensitive name match (only the ends are trimmed). Anything else keeps Delete disabled. */
function DeleteDialog({ event, onClose, onGone }: { event: PanelEvent; onClose: () => void; onGone: () => void }) {
  const { t } = useI18n();
  const uid = useId().replace(/:/g, "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ok = text.trim().normalize("NFC") === event.name;

  const run = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setFailed(false);
    const r = await deleteEvent(event.id);
    if (r.status === "ok") {
      setFlash({ kind: "deleted", name: event.name });
      navigate("/panel", false, true);
      return;
    }
    setBusy(false);
    if (r.status === "unauthenticated") navigate("/panel/login", true, true);
    else if (r.status === "not_found") onGone();
    else setFailed(true);
  };

  return (
    <Dialog titleId={`${uid}-t`} descId={`${uid}-d`} initialFocus={() => document.getElementById(`${uid}-in`)} onClose={onClose}>
      <div className="pe-dico"><Ic n="trash" size={24} /></div>
      <h2 id={`${uid}-t`}>{t("peDelTitle")}</h2>
      <p className="pe-dlgp" id={`${uid}-d`}>{t("peDelText")}</p>
      <label className="pe-lbl light" htmlFor={`${uid}-in`}>{t("peDelLabel")}</label>
      <div className="pe-namebox" dir="auto" lang={event.language}>{event.name}</div>
      <input
        id={`${uid}-in`}
        className="pe-inp"
        value={text}
        dir="auto"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        aria-describedby={`${uid}-m`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void run();
          }
        }}
      />
      <div className="pe-msgrow" id={`${uid}-m`} aria-live="polite">
        {ok ? (
          <span className="ok"><Ic n="check" size={16} /><span>{t("peDelYes")}</span></span>
        ) : text ? (
          <span>{t("peDelNo")}</span>
        ) : null}
      </div>
      {failed && <p className="pe-dlgerr" role="alert">{t("peDelFailed")}</p>}
      <div className="pe-acts">
        <button type="button" className="btn" onClick={onClose}>{t("cancel")}</button>
        <button type="button" className="btn danger solid" disabled={!ok || busy} onClick={() => void run()}>
          <Ic n="trash" size={18} />{t("peDelBtn")}
        </button>
      </div>
    </Dialog>
  );
}
