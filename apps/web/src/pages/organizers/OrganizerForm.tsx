import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  ORGANIZER_REQUEST_LIMITS as LIM,
  ORGANIZER_TURNSTILE_ACTION,
  organizerRequestSchema,
  toOrganizerFieldErrors,
  type FieldError,
  type OrganizerLocale,
} from "@atlas/contract";
import { submitOrganizerRequest } from "../../api/organizerRequest";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages";
import { Link } from "../../lib/router";
import { loadTurnstile, siteKey, type TurnstileApi } from "../../lib/turnstile";
import { LogoMark } from "../../markers/Pixel";
import { captureSourceRef, readSourceRef } from "../../lib/sourceRef";

type Field = "name" | "email" | "eventName" | "eventDate" | "city" | "role" | "message";
const EMPTY: Record<Field, string> = { name: "", email: "", eventName: "", eventDate: "", city: "", role: "", message: "" };
const MAX: Record<Field, number> = { name: LIM.name, email: LIM.email, eventName: LIM.eventName, eventDate: LIM.eventDate, city: LIM.city, role: LIM.role, message: LIM.message };
const ORDER: Field[] = ["name", "email", "eventName", "eventDate", "city", "role", "message"];
const REQUIRED_KEY: Partial<Record<Field, MessageKey>> = { name: "orgErrReqName", email: "orgErrReqEmail", eventName: "orgErrReqEvent" };

/** Banner shown above the form (never echoes server text). */
type Banner = "orgErrRejected" | "orgErrRate" | "orgErrDaily" | "orgErr503" | "orgErrNetwork" | "orgErrGeneric" | "orgErrSummary" | "orgErrTs";
const SOFT: Banner[] = ["orgErrRate", "orgErrDaily", "orgErr503", "orgErrNetwork"];

export default function OrganizerForm() {
  const { t, lang, vos } = useI18n();
  const [values, setValues] = useState(EMPTY);
  const [website, setWebsite] = useState(""); // honeypot
  const [errors, setErrors] = useState<Partial<Record<Field, MessageKey>>>({});
  const [tooLong, setTooLong] = useState<Partial<Record<Field, number>>>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ event: string; email: string } | null>(null);
  const [tsReady, setTsReady] = useState(false);
  const [tsFailed, setTsFailed] = useState(false);
  const startedAt = useRef(Date.now()); // when the form rendered: the server's minimum fill time
  const token = useRef<string | null>(null);
  const api = useRef<TurnstileApi | null>(null);
  const widget = useRef<string | undefined>(undefined);
  const tsBox = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const doneHead = useRef<HTMLHeadingElement>(null);
  const uid = useId();
  const id = (f: string) => `${uid}-${f}`;

  // Slice 44: remember a valid ?ref= for this tab (a reload or a language switch keeps it).
  useEffect(() => captureSourceRef(), []);

  // Turnstile: the script is only fetched on this route, once the form is near the screen (right away without IntersectionObserver).
  useEffect(() => {
    if (done) return;
    let live = true;
    const start = () => {
      loadTurnstile().then(
        (ts) => {
          if (!live || !tsBox.current || widget.current !== undefined) return;
          api.current = ts;
          widget.current = ts.render(tsBox.current, {
            sitekey: siteKey,
            action: ORGANIZER_TURNSTILE_ACTION,
            callback: (tk: string) => {
              token.current = tk;
              setBanner((b) => (b === "orgErrTs" ? null : b));
            },
            "expired-callback": () => (token.current = null),
            "error-callback": () => (token.current = null),
          });
          setTsReady(true);
        },
        () => live && setTsFailed(true),
      );
    };
    let io: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === "undefined" || !formRef.current) start();
    else {
      io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (io?.disconnect(), start()), { rootMargin: "600px 0px" });
      io.observe(formRef.current);
    }
    return () => {
      live = false;
      io?.disconnect();
      if (widget.current !== undefined) {
        try {
          api.current?.remove(widget.current);
        } catch {
          /* widget already gone */
        }
        widget.current = undefined;
      }
    };
  }, [done]);

  const resetWidget = () => {
    token.current = null;
    try {
      if (widget.current !== undefined) api.current?.reset(widget.current);
    } catch {
      /* ignore */
    }
  };

  const set = (f: Field, v: string) => {
    setValues((s) => ({ ...s, [f]: v }));
    if (errors[f]) setErrors((e) => ({ ...e, [f]: undefined }));
  };

  /** Contract field errors -> i18n key per field, plus a banner for what is not a field. */
  const applyErrors = (list: FieldError[], vals: Record<Field, string>) => {
    const next: Partial<Record<Field, MessageKey>> = {};
    const long: Partial<Record<Field, number>> = {};
    let b: Banner | null = null;
    for (const { path, code } of list) {
      if (path === "turnstileToken") b = "orgErrTs";
      else if (path === "elapsedMs" || path === "body") b = "orgErrRejected";
      else if ((ORDER as string[]).includes(path)) {
        const f = path as Field;
        if (next[f]) continue;
        if (code === "required") next[f] = REQUIRED_KEY[f] ?? "orgErrInvalid";
        else if (code === "too_long") {
          next[f] = "orgErrTooLong";
          long[f] = vals[f].length;
        } else if (code === "control_chars") next[f] = "orgErrControl";
        else if (code === "invalid" && f === "email") next[f] = "orgErrEmail";
        else next[f] = "orgErrInvalid";
      }
    }
    setErrors(next);
    setTooLong(long);
    const first = ORDER.find((f) => next[f]);
    if (first) {
      setBanner(b ?? "orgErrSummary");
      document.getElementById(id(first))?.focus();
    } else setBanner(b ?? "orgErrGeneric");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const sourceRef = readSourceRef();
    const body = {
      ...values,
      ...(sourceRef ? { sourceRef } : {}),
      pageLang: lang,
      locale: (lang === "es" && vos ? "es-vos" : lang) as OrganizerLocale,
      website,
      elapsedMs: Math.min(Date.now() - startedAt.current, LIM.maxElapsedMs),
      turnstileToken: token.current ?? "",
    };
    const parsed = organizerRequestSchema.safeParse(body);
    if (!parsed.success) {
      applyErrors(toOrganizerFieldErrors(parsed.error), values);
      return;
    }
    setErrors({});
    setTooLong({});
    setBanner(null);
    setBusy(true);
    const r = await submitOrganizerRequest(body);
    setBusy(false);
    if (r.status === "ok") {
      setDone({ event: parsed.data.eventName, email: parsed.data.email });
      return;
    }
    resetWidget(); // tokens are single use: any answer other than success needs a fresh one
    if (r.status === "fields") applyErrors(r.fields, values);
    else
      setBanner(
        r.status === "rejected" ? "orgErrRejected"
        : r.status === "rate_limited" ? "orgErrRate"
        : r.status === "daily_cap" ? "orgErrDaily"
        : r.status === "unavailable" ? "orgErr503"
        : "orgErrNetwork",
      );
  };

  useEffect(() => {
    if (done) doneHead.current?.focus();
  }, [done]);

  if (done) {
    return (
      <div className="org-done" role="status">
        <LogoMark size={44} />
        <h3 ref={doneHead} tabIndex={-1}>{t("orgDoneH")}</h3>
        {/* Plain React text: the event name and email were typed by the visitor and are never rendered as HTML. */}
        <p>{t("orgDoneP", { event: done.event, email: done.email })}</p>
        <Link to="/" className="org-btn sm ghost">{t("orgDoneBack")}</Link>
      </div>
    );
  }

  const text = (f: Field, label: MessageKey, o: { type?: string; ph?: MessageKey; ac?: string; opt?: boolean; help?: MessageKey; area?: boolean } = {}) => {
    const err = errors[f];
    const describedBy = [err ? id(`${f}-e`) : "", o.help ? id(`${f}-h`) : ""].filter(Boolean).join(" ") || undefined;
    const common = {
      id: id(f),
      name: f,
      value: values[f],
      maxLength: MAX[f],
      onChange: (ev: any) => set(f, ev.target.value),
      "aria-invalid": err ? true : undefined,
      "aria-describedby": describedBy,
      "aria-required": !o.opt || undefined,
      placeholder: o.ph ? t(o.ph) : undefined,
      autoComplete: o.ac,
    };
    const n = values[f].length;
    return (
      <div className={`org-fld${err ? " bad" : ""}`}>
        <label htmlFor={id(f)}>
          {t(label)}
          {o.opt ? <em> {t("orgOptional")}</em> : " *"}
        </label>
        {o.area ? <textarea {...common} rows={5} /> : <input {...common} type={o.type ?? "text"} />}
        {o.help && <span className="help" id={id(`${f}-h`)}>{t(o.help)}</span>}
        {err && <span className="errm" id={id(`${f}-e`)}>{t(err, { max: MAX[f], n: tooLong[f] ?? n })}</span>}
        {f === "message" && n >= 1800 && <span className="count" aria-hidden="true">{n} / {MAX.message}</span>}
      </div>
    );
  };

  return (
    <form ref={formRef} className="org-form" onSubmit={submit} noValidate aria-busy={busy || undefined}>
      {banner && (
        <div className={`org-summary ${SOFT.includes(banner) ? "warn" : "bad"}`} role="alert">
          {t(banner)}
        </div>
      )}
      <p className="org-req">{t("orgRequired")}</p>
      <div className="org-row2">
        {text("name", "orgFName", { ac: "name" })}
        {text("email", "orgFEmail", { type: "email", ac: "email" })}
      </div>
      {text("eventName", "orgFEvent", { ph: "orgFEventPh" })}
      <div className="org-row2">
        {text("eventDate", "orgFDate", { opt: true, ph: "orgFDatePh" })}
        {text("city", "orgFCity", { opt: true, ac: "address-level2" })}
      </div>
      {text("role", "orgFRole", { opt: true, ph: "orgFRolePh" })}
      {text("message", "orgFMessage", { opt: true, area: true, help: "orgFMessageHelp" })}
      {/* Honeypot: off-screen (not display:none, which bots skip), out of the tab order and hidden from assistive tech. */}
      <div className="org-hp" aria-hidden="true">
        <label htmlFor={id("website")}>Website</label>
        <input id={id("website")} name="website" type="text" tabIndex={-1} autoComplete="off" value={website} maxLength={LIM.website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      <div className="org-ts" role="group" aria-label={t("orgTsLabel")}>
        <div ref={tsBox} />
        {!tsReady && !tsFailed && <p className="org-tsmsg" role="status">{t("orgTsLoading")}</p>}
        {tsFailed && <p className="org-tsmsg" role="alert">{t("orgErrNetwork")}</p>}
      </div>
      <button type="submit" className="org-btn" disabled={busy}>
        {busy ? t("orgSubmitting") : t("orgSubmit")}
      </button>
      <p className="org-fnote">
        {t("orgCollects")} <Link to="/privacy">{t("privacyLink")}</Link>
      </p>
      <p className="org-fnote">
        {t("termsFormPre")} <Link to="/terms">{t("termsLink")}</Link>.
      </p>
    </form>
  );
}
