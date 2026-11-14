import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { COUNTRY_CODES, EVENT_LANGUAGES, EVENT_TIME_ZONES, type PanelEvent } from "@atlas/contract";
import { createEvent, getEvent, updateEvent } from "../../../api/panelEvents";
import { useI18n } from "../../../i18n/I18nProvider";
import { LANG_NAMES, type Lang, type MessageKey } from "../../../i18n/messages";
import { countryName } from "../../../lib/events";
import {
  FIELD_ORDER,
  blankValues,
  daysInclusive,
  fromEvent,
  fromServer,
  textLength,
  toInput,
  validate,
  websiteMessageKey,
  websiteProblem,
  type FieldKey,
  type FormValues,
  type Issue,
  type Issues,
} from "../../../lib/eventForm";
import { Link, navigate, setNavigationGuard } from "../../../lib/router";
import { browserZone, zoneLabel, zoneOffset } from "../../../lib/timeZones";
import { AboutRows } from "./About";
import { Dialog, Ic, LoadError, Loading, PanelNotFound, dateRange, dayNumber, longDay, monthShort, pastel, setFlash, useDocTitle } from "./common";
import Picker, { type Option } from "./Picker";

/** /panel/events/new and /panel/events/:id/edit. The edit form loads the event first. */
export default function EventForm({ id }: { id?: string }) {
  const { t } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"loading" | "error" | "missing" | PanelEvent>(id ? "loading" : "missing");

  useEffect(() => {
    if (!id) return;
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

  useDocTitle(`${t(id ? "peEditEvent" : "peNewEvent")} · ${t("appName")}`);

  if (!id) return <FormBody key="new" />;
  if (state === "loading") return <Loading />;
  if (state === "error") return <LoadError onRetry={() => setAttempt((n) => n + 1)} />;
  if (state === "missing") return <PanelNotFound />;
  return <FormBody key={state.id} event={state} />;
}

const TEXT_KEYS = new Set<FieldKey>(["name", "city", "description", "website"]);
const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function FormBody({ event }: { event?: PanelEvent }) {
  const { t, lang } = useI18n();
  const pid = useId().replace(/:/g, "");
  const fid = (k: string) => `${pid}-${k}`;
  const editing = !!event;
  const backTo = event ? `/panel/events/${event.id}` : "/panel";

  const baseline = useMemo(() => (event ? fromEvent(event) : blankValues(lang)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [values, setValues] = useState<FormValues>(baseline);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverIssues, setServerIssues] = useState<Issues>({});
  const [banner, setBanner] = useState<null | "limit" | "failed">(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const previewId = useRef(event?.id ?? Math.random().toString(36).slice(2, 10)).current;
  const detected = useMemo(() => browserZone(), []);

  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);
  const clientIssues = useMemo(() => validate(values), [values]);

  // Leaving with changes asks first: in-app navigation through the router guard, tab close through beforeunload.
  useEffect(() => {
    if (!dirty) return;
    const off = setNavigationGuard((to) => {
      setPending(to);
      return false;
    });
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      off();
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [dirty]);

  // "Add" on the hub opens this form on that field.
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("focus");
    if (want === "description" || want === "website") document.getElementById(fid(want))?.focus();
    else document.getElementById(fid("name"))?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (focusTick) (summaryRef.current ?? bannerRef.current)?.focus();
  }, [focusTick]);

  const issueFor = (k: FieldKey): Issue | undefined => serverIssues[k] ?? (submitted || touched[k] ? clientIssues[k] : undefined);

  const setField = (k: FieldKey, v: string) => {
    setValues((s) => ({ ...s, [k]: v }));
    if (serverIssues[k]) setServerIssues(({ [k]: _drop, ...rest }) => rest);
    if (banner === "failed") setBanner(null);
  };
  const touch = (k: FieldKey) => setTouched((s) => (s[k] ? s : { ...s, [k]: true }));

  const message = (k: FieldKey, code: Issue): { text: string; fix?: string } => {
    const choose = k === "timeZone" || k === "country" || k === "language";
    switch (code) {
      case "required":
        return { text: t(choose ? "peErrChoose" : "peErrRequired") };
      case "too_short":
        return { text: k === "name" ? t("peErrNameShort", { n: textLength(values.name) }) : t("peErrRequired") };
      case "too_long":
        if (k === "name") return { text: t("peErrNameLong", { n: textLength(values.name) }) };
        if (k === "city") return { text: t("peErrCityLong", { n: textLength(values.city) }) };
        if (k === "description") return { text: t("peErrDescLong", { n: Math.max(1, textLength(values.description) - 500) }) };
        if (k === "website") return { text: t("peErrWebLong") };
        return { text: t("peErrInvalid") };
      case "invalid_date":
        return { text: t("peErrDate") };
      case "end_before_start":
        return { text: t("peErrEndBefore", { d: longDay(values.startDate, lang) }) };
      case "span_too_long":
        return { text: t("peErrSpan", { n: daysInclusive(values.startDate, values.endDate) ?? "" }) };
      case "invalid_time_zone":
      case "invalid_country":
      case "invalid_language":
        return { text: t("peErrChoose") };
      case "website_not_https":
      case "invalid_url": {
        const p = websiteProblem(values.website, code);
        return { text: t(websiteMessageKey(p.kind)), fix: p.fix ?? undefined };
      }
      case "control_chars":
        return { text: t("peErrControl") };
      default:
        return { text: t("peErrInvalid") };
    }
  };

  const shownKeys = FIELD_ORDER.filter((k) => issueFor(k));
  const labelKey: Record<FieldKey, MessageKey> = {
    name: "peName", language: "peLang", startDate: "peStart", endDate: "peEnd", timeZone: "peTz",
    city: "peCity", country: "peCountry", description: "peDesc", website: "peWeb",
  };

  const submit = async () => {
    if (saving) return;
    setSubmitted(true);
    setBanner(null);
    if (Object.keys(clientIssues).length) {
      setFocusTick((n) => n + 1);
      return;
    }
    setSaving(true);
    const r = event ? await updateEvent(event.id, toInput(values)) : await createEvent(toInput(values));
    if (r.status === "ok") {
      setFlash({ kind: event ? "changes" : "saved" });
      navigate(`/panel/events/${r.event.id}`, false, true);
      return;
    }
    setSaving(false);
    if (r.status === "unauthenticated") navigate("/panel/login", true, true);
    else if (r.status === "not_found") setNotFound(true);
    else if (r.status === "invalid") {
      const { issues, unknown } = fromServer(r.fields);
      setServerIssues(issues);
      if (unknown) setBanner("failed");
    } else setBanner(r.status === "limit" ? "limit" : "failed"); // typed values stay in the form
    setFocusTick((n) => n + 1);
  };

  const onFormKey = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  if (notFound) return <PanelNotFound />;

  // ---- pieces ----
  const msgRow = (k: FieldKey, extra?: ReactNode, hint?: ReactNode) => {
    const code = issueFor(k);
    const m = code ? message(k, code) : null;
    return (
      <div className="pe-msgrow" id={fid(`${k}-m`)}>
        {m ? (
          <span>
            <span className="err"><Ic n="warn" size={16} /><span>{m.text}</span></span>
            {m.fix && (
              <button type="button" className="btn sm pe-fixbtn" onClick={() => { setField("website", m.fix!); document.getElementById(fid("website"))?.focus(); }}>
                <Ic n="check" size={16} /><span dir="auto">{t("peFixUse", { u: m.fix })}</span>
              </button>
            )}
          </span>
        ) : (
          hint ?? <span />
        )}
        {extra}
      </div>
    );
  };
  const bad = (k: FieldKey) => !!issueFor(k);

  const textInput = (k: FieldKey, extra: Record<string, unknown> = {}) => (
    <input
      className="pe-inp"
      id={fid(k)}
      value={values[k]}
      dir="auto"
      autoComplete="off"
      aria-invalid={bad(k)}
      aria-describedby={fid(`${k}-m`)}
      onChange={(e) => setField(k, e.target.value)}
      onBlur={() => touch(k)}
      {...extra}
    />
  );

  const tzLabel = (z: string) => {
    const l = zoneLabel(z);
    return `${l.city} (${zoneOffset(z, refDate)})`;
  };
  const refDate = daysInclusive(values.startDate, values.startDate) ? new Date(`${values.startDate}T12:00:00Z`) : new Date();
  const tzOptions = (): Option[] => {
    const all = EVENT_TIME_ZONES.map((z) => ({ value: z, text: tzLabel(z), sub: zoneLabel(z).region, group: "all" }));
    return detected ? [{ value: detected, text: tzLabel(detected), sub: zoneLabel(detected).region, group: "pinned" }, ...all] : all;
  };
  const countryOptions = (): Option[] =>
    COUNTRY_CODES.map((c) => ({ value: c, text: countryName(c, lang) })).sort((a, b) => a.text.localeCompare(b.text, lang));

  const dateIssue = (["startDate", "endDate"] as FieldKey[]).find((k) => issueFor(k));
  const days = daysInclusive(values.startDate, values.endDate);
  const dateMsg = dateIssue ? (
    <span className="err"><Ic n="warn" size={16} /><span>{message(dateIssue, issueFor(dateIssue)!).text}</span></span>
  ) : days && !clientIssues.endDate && !clientIssues.startDate ? (
    <span className="ok"><Ic n="check" size={16} /><span>{days === 1 ? t("peLasts1") : t("peLastsN", { n: days })}</span></span>
  ) : null;

  const saveLabel = saving ? t("peSaving") : t(editing ? "peSaveChanges" : "peSave");
  const sectionNum = (n: number) => <span className="pe-sn" aria-hidden="true">{n}</span>;

  const goSummary = (k: FieldKey) => {
    const el = k === "language" ? document.querySelector<HTMLElement>(`input[name="${fid("language")}"]:checked`) : document.getElementById(fid(k));
    el?.focus();
  };

  return (
    <div className="pe-page">
      <form className="pe-fpage" noValidate onSubmit={onSubmit} onKeyDown={onFormKey} aria-label={t(editing ? "peEditEvent" : "peNewEvent")}>
        <div className="pe-fbar">
          <Link to={backTo} className="pe-back">
            <Ic n="left" size={18} />
            <span dir="auto">{event ? event.name : t("myEvents")}</span>
          </Link>
          <h1>{t(editing ? "peEditEvent" : "peNewEvent")}</h1>
          <div className="pe-dkacts">
            <button type="button" className="btn ghost" onClick={() => navigate(backTo)}>{t("cancel")}</button>
            <button type="submit" className="btn primary" disabled={saving}>
              {saveLabel}
              <kbd aria-hidden="true">{isMac() ? "⌘" : "Ctrl"} ↵</kbd>
            </button>
          </div>
        </div>

        <div className="pe-fgrid">
          <div className="pe-fcol">
            {banner && (
              <div className="pe-alert" role="alert" tabIndex={-1} ref={bannerRef}>
                <Ic n="warn" />
                <span>{t(banner === "limit" ? "peLimitServer" : "peErrSaveFailed")}</span>
              </div>
            )}
            {submitted && shownKeys.length > 0 && (
              <div className="pe-summary" role="alert" tabIndex={-1} ref={summaryRef}>
                <b><Ic n="warn" size={18} />{shownKeys.length === 1 ? t("peSum1") : t("peSumN", { n: shownKeys.length })}</b>
                <ul>
                  {shownKeys.map((k) => (
                    <li key={k}>
                      <button type="button" className="pe-linkbtn" onClick={() => goSummary(k)}>{t(labelKey[k])}</button>
                      : {message(k, issueFor(k)!).text}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <section className="pe-fsec">
              <h2>{sectionNum(1)}{t("peSecBasics")}</h2>
              <div className={`pe-field${bad("name") ? " bad" : ""}`}>
                <label className="pe-lbl" htmlFor={fid("name")}>{t("peName")}</label>
                {textInput("name", { spellCheck: true })}
                {msgRow("name", <span className={`pe-cnt${textLength(values.name) > 80 ? " over" : ""}`} aria-hidden="true">{textLength(values.name)}/80</span>)}
              </div>
              <fieldset className={`pe-field${bad("language") ? " bad" : ""}`} aria-describedby={fid("language-m")}>
                <legend className="pe-lbl">{t("peLang")}</legend>
                <div className="pe-seg">
                  {EVENT_LANGUAGES.map((l) => (
                    <label key={l}>
                      <input
                        type="radio"
                        name={fid("language")}
                        value={l}
                        checked={values.language === l}
                        onChange={() => setField("language", l)}
                      />
                      {LANG_NAMES[l as Lang]}
                    </label>
                  ))}
                </div>
                {msgRow("language", null, <span className="pe-hint">{t("peLangHint")}</span>)}
              </fieldset>
            </section>

            <section className="pe-fsec">
              <h2>{sectionNum(2)}{t("peSecWhen")}</h2>
              <div className="pe-two">
                {(["startDate", "endDate"] as const).map((k) => (
                  <div key={k} className={`pe-field${bad(k) ? " bad" : ""}`}>
                    <label className="pe-lbl" htmlFor={fid(k)}>{t(k === "startDate" ? "peStart" : "peEnd")}</label>
                    <input
                      type="date"
                      className="pe-inp"
                      id={fid(k)}
                      min="2000-01-01"
                      max="2099-12-31"
                      value={values[k]}
                      aria-invalid={bad(k)}
                      aria-describedby={fid("dates-m")}
                      onChange={(e) => {
                        setField(k, e.target.value);
                        // Moving the start past the end is a mistake worth showing straight away.
                        if (k === "startDate" && values.endDate) touch("endDate");
                      }}
                      onBlur={() => touch(k)}
                    />
                  </div>
                ))}
              </div>
              <div className="pe-datemsg">
                <div className="pe-msgrow" id={fid("dates-m")} aria-live="polite">{dateMsg}</div>
              </div>
              <div className={`pe-field${bad("timeZone") ? " bad" : ""}`}>
                <span className="pe-lbl" id={fid("tz-l")}>{t("peTz")}</span>
                <Picker
                  id={fid("timeZone")}
                  labelledBy={fid("tz-l")}
                  describedBy={fid("timeZone-m")}
                  invalid={bad("timeZone")}
                  value={values.timeZone}
                  searchLabel={t("peTzSearch")}
                  getOptions={tzOptions}
                  onPick={(v) => setField("timeZone", v)}
                  onClose={() => touch("timeZone")}
                  display={
                    values.timeZone ? (
                      <span className="v" dir="auto">
                        <b>{tzLabel(values.timeZone)}</b>
                        <small>{zoneLabel(values.timeZone).region || values.timeZone}</small>
                      </span>
                    ) : (
                      <span className="v ph">{t("peTzPh")}</span>
                    )
                  }
                />
                {msgRow("timeZone", null, values.timeZone && values.timeZone === detected ? <span>{t("peTzHint")}</span> : <span />)}
              </div>
            </section>

            <section className="pe-fsec">
              <h2>{sectionNum(3)}{t("peSecWhere")}</h2>
              <div className="pe-pair">
                <div className={`pe-field${bad("city") ? " bad" : ""}`}>
                  <label className="pe-lbl" htmlFor={fid("city")}>{t("peCity")}</label>
                  {textInput("city")}
                  {msgRow("city")}
                </div>
                <div className={`pe-field${bad("country") ? " bad" : ""}`}>
                  <span className="pe-lbl" id={fid("country-l")}>{t("peCountry")}</span>
                  <Picker
                    id={fid("country")}
                    labelledBy={fid("country-l")}
                    describedBy={fid("country-m")}
                    invalid={bad("country")}
                    value={values.country}
                    searchLabel={t("peCountrySearch")}
                    getOptions={countryOptions}
                    onPick={(v) => setField("country", v)}
                    onClose={() => touch("country")}
                    display={
                      values.country ? (
                        <span className="v"><b>{countryName(values.country, lang)}</b></span>
                      ) : (
                        <span className="v ph">{t("peCountryPh")}</span>
                      )
                    }
                  />
                  {msgRow("country")}
                </div>
              </div>
            </section>

            <section className="pe-fsec">
              <h2>{sectionNum(4)}{t("peSecAbout")}</h2>
              <div className={`pe-field${bad("description") ? " bad" : ""}`}>
                <label className="pe-lbl" htmlFor={fid("description")}>
                  {t("peDesc")} <span className="o">({t("peOptional")})</span>
                </label>
                <textarea
                  className="pe-inp"
                  id={fid("description")}
                  rows={4}
                  dir="auto"
                  value={values.description}
                  aria-invalid={bad("description")}
                  aria-describedby={fid("description-m")}
                  onChange={(e) => setField("description", e.target.value)}
                  onBlur={() => touch("description")}
                />
                {msgRow(
                  "description",
                  <span className={`pe-cnt${textLength(values.description) > 500 ? " over" : ""}`}>{textLength(values.description)}/500</span>,
                  <span className="pe-hint f">{t("peDescHint")}</span>,
                )}
              </div>
              <div className={`pe-field${bad("website") ? " bad" : ""}`}>
                <label className="pe-lbl" htmlFor={fid("website")}>
                  {t("peWeb")} <span className="o">({t("peOptional")})</span>
                </label>
                {textInput("website", { type: "text", inputMode: "url", placeholder: "https://", spellCheck: false, autoCapitalize: "off", dir: "ltr" })}
                {msgRow("website", null, <span className="pe-hint f">{t("peWebHint")}</span>)}
              </div>
            </section>

            <div className="pe-savebar">
              <button type="button" className="btn" onClick={() => navigate(backTo)}>{t("cancel")}</button>
              <button type="submit" className="btn primary" disabled={saving}>{saveLabel}</button>
            </div>
          </div>

          <aside className="pe-pvcol" aria-hidden="true">
            <LivePreview values={values} id={previewId} />
          </aside>
        </div>
      </form>

      {pending !== null && (
        <Dialog
          titleId={fid("xt")}
          descId={fid("xd")}
          initialFocus={() => document.getElementById(fid("keep"))}
          onClose={() => setPending(null)}
        >
          <div className="pe-dico neutral"><Ic n="undo" size={24} /></div>
          <h2 id={fid("xt")}>{t("peDiscTitle")}</h2>
          <p className="pe-dlgp" id={fid("xd")}>{t("peDiscText")}</p>
          <div className="pe-acts">
            <button type="button" className="btn primary" id={fid("keep")} onClick={() => setPending(null)}>{t("peDiscNo")}</button>
            <button type="button" className="btn danger" onClick={() => navigate(pending, false, true)}>{t("peDiscYes")}</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** The right column (desktop): the card and the "About the event" sheet build as you type. No requests. */
function LivePreview({ values, id }: { values: FormValues; id: string }) {
  const { t, lang } = useI18n();
  const f = values;
  const name = f.name.trim();
  const start = daysInclusive(f.startDate, f.startDate) ? f.startDate : "";
  const end = start && daysInclusive(f.startDate, f.endDate) ? f.endDate : start;
  const range = start ? dateRange(start, end, lang) : "";
  const sk = (w: number) => <span className="pe-sk" style={{ width: w }} />;
  return (
    <>
      <p className="pe-pvlabel"><Ic n="eye" size={16} />{t("peLivePv")}</p>
      <div className="pe-hcard">
        <div className="pe-cover" style={pastel(id)}>
          {start ? (
            <span className="pe-dnum">{dayNumber(start)}<small>{monthShort(start, lang)}</small></span>
          ) : (
            <span className="pe-dnum" style={{ opacity: 0.35 }}>··<small>···</small></span>
          )}
          <span className="pe-pill draft">{t("peDraft")}</span>
        </div>
        <div className="pe-body">
          <b dir="auto">{name || sk(190)}</b>
          <small>
            {range || sk(110)} · {f.city.trim() ? <span dir="auto">{f.city.trim()}</span> : sk(70)}
          </small>
        </div>
      </div>
      <div className="pe-mini">
        <p className="pe-mh"><Ic n="info" size={16} />{t("pePvAbout")}</p>
        <h3 dir="auto" lang={f.language}>{name || sk(160)}</h3>
        <AboutRows
          start={start}
          end={end}
          timeZone={f.timeZone}
          city={f.city}
          country={f.country}
          description={f.description.trim().slice(0, 500)}
          website={f.website.trim()}
          language={f.language}
          linkWebsite={false}
        />
      </div>
    </>
  );
}
