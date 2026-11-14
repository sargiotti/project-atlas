import { useEffect, useRef, useState, type FormEvent } from "react";
import { createInviteRequestSchema, type InviteSummary } from "@atlas/contract";
import { createInvite, listInvites, revokeInvite } from "../../api/auth";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages";
import { Link, navigate } from "../../lib/router";
import { BoldSlot } from "./parts";
import { NoAccess } from "./PanelGuard";

const CREATE_ERRORS: Record<string, MessageKey> = {
  email_already_registered: "err_email_already_registered",
  invite_already_pending: "err_invite_already_pending",
  invite_cap_reached: "err_invite_cap_reached",
};

// Held in component state only: never persisted, never re-fetched (the API returns the token once).
type Created = { email: string; link: string };

function useWhen() {
  const { lang } = useI18n();
  const rel = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const date = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return {
    created: (iso: string) => date.format(new Date(iso)),
    /** Relative expiry plus whether it is under 48 h (danger style). */
    expires: (iso: string) => {
      const ms = new Date(iso).getTime() - Date.now();
      const hours = ms / 36e5;
      const text = hours < 24 ? rel.format(Math.max(0, Math.round(hours)), "hour") : rel.format(Math.round(hours / 24), "day");
      return { text, soon: hours < 48 };
    },
  };
}

export default function AdminInvites() {
  const { t } = useI18n();
  const when = useWhen();
  const [list, setList] = useState<{ kind: "loading" | "error" | "forbidden" } | { kind: "ok"; invites: InviteSummary[] }>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; key: MessageKey } | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const copyTimer = useRef<number | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setList({ kind: "loading" });
    listInvites(ctrl.signal)
      .then((r) => {
        if (r.status === "unauthenticated") navigate("/panel/login", true);
        else if (r.status === "ok") setList({ kind: "ok", invites: r.invites });
        else setList({ kind: r.status });
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [attempt]);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const parsed = createInviteRequestSchema.safeParse({ email });
    if (!parsed.success) return setEmailError("emailInvalid");
    setEmailError(null);
    setBusy(true);
    const r = await createInvite(parsed.data.email);
    setBusy(false);
    if (r.status === "ok") {
      setCreated({ email: r.invite.email, link: window.location.origin + r.invitePath });
      setCopied(false);
      setEmail("");
      setList((l) => (l.kind === "ok" ? { kind: "ok", invites: [r.invite, ...l.invites.filter((i) => i.id !== r.invite.id)] } : l));
    } else if (r.status === "failed" && (r.http === 401 || r.http === 403) && r.code !== "invalid_origin") {
      if (r.http === 401) navigate("/panel/login", true);
      else setList({ kind: "forbidden" });
    } else {
      setEmailError(r.status === "failed" ? (CREATE_ERRORS[r.code] ?? (r.code === "validation_error" ? "emailInvalid" : "err_generic")) : "err_generic");
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.link);
    } catch {
      linkInput.current?.select();
      document.execCommand?.("copy");
    }
    setCopied(true);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 3000);
  };

  const revoke = async (id: string) => {
    setRowError(null);
    const r = await revokeInvite(id);
    if (r.status === "ok" || r.status === "gone" || r.status === "used") {
      setList((l) => (l.kind === "ok" ? { kind: "ok", invites: l.invites.filter((i) => i.id !== id) } : l));
      setConfirmId(null);
      if (r.status === "used") setRowError({ id: "", key: "revokeUsed" });
    } else {
      setRowError({ id, key: "revokeFailed" });
    }
  };

  if (list.kind === "forbidden") return <NoAccess />;

  return (
    <>
      <Link to="/panel" className="back">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
        {t("myEvents")}
      </Link>
      <div className="phead"><h1>{t("invitesNav")}</h1></div>
      <p className="muted small">{t("invitesLead")}</p>

      <form className="iform" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="invite-email">{t("inviteEmailLabel")}</label>
          <input
            id="invite-email"
            className={`input${emailError ? " bad" : ""}`}
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            required
            placeholder={t("inviteEmailPlaceholder")}
            value={email}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? "invite-email-error" : undefined}
            onChange={(e) => setEmail(e.target.value)}
          />
          {emailError && (
            <p id="invite-email-error" className="hint bad" role="alert">{t(emailError)}</p>
          )}
        </div>
        <button type="submit" className="btn primary block" disabled={busy}>
          {busy ? t("inviteCreating") : t("inviteCreate")}
        </button>
      </form>

      {created && (
        <section className="created" aria-labelledby="created-title">
          <h2 id="created-title">{t("inviteReadyTitle")}</h2>
          <p className="muted small" role="status">
            <BoldSlot template={t("inviteReadyBody")} token="email" value={created.email} />
          </p>
          <input
            ref={linkInput}
            className="linkbox"
            readOnly
            value={created.link}
            aria-label={t("inviteLinkLabel")}
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="acts">
            <button type="button" className="btn primary" onClick={copy}>{copied ? t("copied") : t("copyInvite")}</button>
            <button type="button" className="btn" onClick={() => { setCreated(null); setCopied(false); }}>{t("done")}</button>
          </div>
          {copied && <p className="sr-only" role="status">{t("linkCopied")}</p>}
        </section>
      )}

      {rowError?.id === "" && <p className="hint bad" role="alert">{t(rowError.key)}</p>}

      {list.kind === "loading" && <p className="loading" role="status">{t("listLoading")}</p>}
      {list.kind === "error" && (
        <div className="state">
          <p className="muted">{t("listError")}</p>
          <button type="button" className="btn primary" onClick={() => setAttempt((n) => n + 1)}>{t("retry")}</button>
        </div>
      )}
      {list.kind === "ok" && list.invites.length === 0 && (
        <div className="empty">
          <h2>{t("noPendingInvites")}</h2>
        </div>
      )}
      {list.kind === "ok" && list.invites.length > 0 && (
        <ul className="ilist">
          <li className="ihead" aria-hidden="true">
            <span>{t("colEmail")}</span><span>{t("colCreated")}</span><span>{t("colExpires")}</span><span />
          </li>
          {list.invites.map((inv) => {
            const exp = when.expires(inv.expiresAt);
            return (
              <li key={inv.id} className="icard">
                <b className="iemail">{inv.email}</b>
                <span className="muted small icreated">{t("createdOn", { when: when.created(inv.createdAt) })}</span>
                <span className={`pill iexp${exp.soon ? " soon" : ""}`}>{t("expiresRel", { when: exp.text })}</span>
                <button type="button" className="btn danger irevoke" onClick={() => { setConfirmId(inv.id); setRowError(null); }} aria-label={`${t("revoke")} ${inv.email}`}>
                  {t("revoke")}
                </button>
                {confirmId === inv.id && (
                  <div className="confirm">
                    <p role="alert">{t("revokeConfirm")}</p>
                    <button type="button" className="btn ghost" onClick={() => setConfirmId(null)}>{t("cancel")}</button>
                    <button type="button" className="btn danger solid" onClick={() => revoke(inv.id)}>{t("revoke")}</button>
                    {rowError?.id === inv.id && <p className="hint bad" role="alert">{t(rowError.key)}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
