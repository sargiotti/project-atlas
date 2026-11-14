import { useEffect, useState } from "react";
import { INVITE_TOKEN_REGEX } from "@atlas/contract";
import { inspectInvite, type InspectResult } from "../../api/auth";
import { useI18n } from "../../i18n/I18nProvider";
import { Link } from "../../lib/router";
import { Alert, AuthFrame, BoldSlot, errorKey, GoogleButton, MAIL } from "./parts";

type State = { kind: "loading" } | { kind: "error" } | { kind: "done"; result: InspectResult };

const BROKEN = (
  <svg className="ic" viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">
    <path d="M9 15l-1.5 1.5a3.5 3.5 0 0 1-5-5L5 9M15 9l1.5-1.5a3.5 3.5 0 0 1 5 5L19 15M8 2v3M2 8h3M16 22v-3M22 16h-3" />
  </svg>
);
const USERX = (
  <svg className="ic" viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">
    <circle cx="10" cy="8" r="4" />
    <path d="M2 21c0-4 4-6 8-6 1.5 0 3 .3 4.2.9M16 15l5 5M21 15l-5 5" />
  </svg>
);

export default function InvitePage({ token }: { token: string }) {
  const { t } = useI18n();
  const validShape = INVITE_TOKEN_REGEX.test(token);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!validShape) return;
    const ctrl = new AbortController();
    setState({ kind: "loading" });
    inspectInvite(token, ctrl.signal)
      .then((result) => setState(result.status === "error" ? { kind: "error" } : { kind: "done", result }))
      .catch(() => {});
    return () => ctrl.abort();
  }, [token, validShape, attempt]);

  const end = (title: string) => (
    <div className="status">
      <div className="ico">{BROKEN}</div>
      <h1>{title}</h1>
      <p className="muted">{t("inviteEndBody")}</p>
      <Link to="/panel/login" className="btn">{t("inviteEndSignIn")}</Link>
    </div>
  );

  let body = null;
  if (!validShape) body = end(t("inviteInvalidTitle"));
  else if (state.kind === "loading") body = <p className="loading" role="status">{t("panelLoading")}</p>;
  else if (state.kind === "error") {
    body = (
      <div className="status">
        <h1>{t("err_generic")}</h1>
        <button type="button" className="btn primary" onClick={() => setAttempt((n) => n + 1)}>{t("retry")}</button>
      </div>
    );
  } else if (state.result.status === "not_found") body = end(t("inviteInvalidTitle"));
  else if (state.result.status === "ok") {
    const invite = state.result.invite;
    if (invite.status !== "valid") {
      body = end(t(invite.status === "expired" ? "inviteExpiredTitle" : invite.status === "used" ? "inviteUsedTitle" : "inviteInvalidTitle"));
    } else {
      const code = errorKey(new URLSearchParams(window.location.search).get("error"));
      const bound = (
        <div className="bound">
          {MAIL}
          <span>{invite.email}</span>
        </div>
      );
      if (code === "err_invite_email_mismatch") {
        // The redirect carries no emails: show only the invited one and offer the account chooser again.
        body = (
          <div className="status">
            <div className="ico">{USERX}</div>
            <h1>{t("mismatchTitle")}</h1>
            <p className="muted">{t("mismatchBody")}</p>
            {bound}
            <p className="blabel">{t("mismatchChoose")}</p>
            <GoogleButton label={t("mismatchTry")} inviteToken={token} />
            <p className="fine">{t("mismatchHelp")}</p>
          </div>
        );
      } else {
        body = (
          <div className="auth">
            <h1>{t("inviteTitle")}</h1>
            <p className="invite-meta">
              <span><BoldSlot template={t("inviteMeta")} token="name" value={invite.inviterName} /></span>
            </p>
            <p className="blabel">{t("inviteFor")}</p>
            {bound}
            {code && <Alert>{t(code)}</Alert>}
            <GoogleButton label={t("googleContinue")} inviteToken={token} />
            <p className="fine">{t("inviteFine")}</p>
            <p className="foot">{t("inviteHaveAccount")} <Link to="/panel/login">{t("signInLink")}</Link></p>
          </div>
        );
      }
    }
  }
  return <AuthFrame>{body}</AuthFrame>;
}
