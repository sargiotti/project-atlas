import { useId, useRef, useState } from "react";
import { INVITE_NOTE_MAX, normalizeInviteNote, type OrganizerRequestRow } from "@atlas/contract";
import { requestAction } from "../../../api/organizerRequest";
import { useI18n } from "../../../i18n/I18nProvider";
import type { MessageKey } from "../../../i18n/messages";
import { navigate } from "../../../lib/router";
import { Dialog } from "../events/common";

type Props = {
  request: OrganizerRequestRow;
  /** "invite-again" for Invited rows. A plain Invite that hits invite_already_pending switches to it inside the dialog. */
  mode: "invite" | "invite-again";
  /** The row changed on the server (invite sent): the page updates the list and shows a toast when the email went out. */
  onChanged: (row: OrganizerRequestRow, sent: boolean) => void;
  /** The list may be out of date (409): the page refreshes it. */
  onStale: () => void;
  onClose: () => void;
};

const ERRORS: Record<string, MessageKey> = {
  invalid_transition: "reqErrStale",
  email_already_registered: "reqErrRegistered",
  invite_cap_reached: "reqErrCap",
  validation_error: "reqErrNote",
  not_found: "reqErrStale",
};

/**
 * Invite / Invite again from an access request (slice 31). The recipient comes from the stored request (read only here).
 * A link returned after a failed or skipped email lives ONLY in this component's state: never in the URL, storage, cache
 * or console, and it is gone when the dialog closes.
 */
export default function InviteRequestDialog({ request, mode: initialMode, onChanged, onStale, onClose }: Props) {
  const { t } = useI18n();
  const uid = useId().replace(/:/g, "");
  const [mode, setMode] = useState(initialMode);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [link, setLink] = useState<{ url: string; why: "failed" | "skipped" } | null>(null);
  const [copy, setCopy] = useState<"idle" | "ok" | "failed">("idle");
  const [stale, setStale] = useState(false);
  const linkInput = useRef<HTMLInputElement>(null);
  const n = normalizeInviteNote(note).length;
  const over = n > INVITE_NOTE_MAX;

  const send = async () => {
    if (busy || over) return;
    setBusy(true);
    setError(null);
    const r = await requestAction(request.id, mode, normalizeInviteNote(note) || undefined);
    setBusy(false);
    if (r.status === "unauthenticated") return navigate("/panel/login", true);
    if (r.status === "ok") {
      const sent = r.emailStatus === "sent";
      onChanged(r.request, sent);
      if (sent || !r.inviteLink) return onClose();
      setLink({ url: r.inviteLink, why: r.emailStatus === "skipped" ? "skipped" : "failed" });
      return;
    }
    if (r.status === "failed") {
      if (r.code === "invite_already_pending") {
        setError("reqErrPending");
        setMode("invite-again");
        return;
      }
      if (r.code === "invalid_transition" || r.code === "not_found" || r.code === "email_already_registered") setStale(true);
      setError(ERRORS[r.code] ?? "reqErrGeneric");
      return;
    }
    setError(r.status === "forbidden" ? "reqErrGeneric" : "reqErrGeneric");
  };

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopy("ok");
    } catch {
      linkInput.current?.select();
      setCopy("failed");
    }
  };

  const close = () => {
    if (stale) onStale();
    onClose();
  };

  const title = mode === "invite-again" ? t("reqInviteAgainTitle", { name: request.name }) : t("reqInviteTitle", { name: request.name });

  return (
    <Dialog titleId={`${uid}-t`} descId={`${uid}-d`} initialFocus={() => document.getElementById(link ? `${uid}-l` : `${uid}-n`)} onClose={busy ? () => {} : close}>
      <h2 id={`${uid}-t`} dir="auto">{title}</h2>
      {link ? (
        <div className="req-link">
          <p className="pe-dlgp" id={`${uid}-d`} role="alert"><b>{t(link.why === "failed" ? "reqEmailFailedT" : "reqEmailSkippedT")}</b></p>
          <label htmlFor={`${uid}-l`} className="req-lbl">{t("reqLinkLabel")}</label>
          <input id={`${uid}-l`} ref={linkInput} className="linkbox" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
          <p className="hint">{t("reqLinkOnce")}</p>
          <div className="pe-acts">
            <button type="button" className="btn primary" onClick={() => void copyLink()}>{copy === "ok" ? t("reqLinkCopied") : t("reqCopyLink")}</button>
            <button type="button" className="btn" onClick={close}>{t("reqDone")}</button>
          </div>
          {copy === "failed" && <p className="hint bad" role="alert">{t("reqCopyFailed")}</p>}
        </div>
      ) : (
        <>
          <p className="pe-dlgp" id={`${uid}-d`}>{t(mode === "invite-again" ? "reqInviteAgainText" : "reqInviteText")}</p>
          <div className="ad-fld">
            <label htmlFor={`${uid}-e`}>{t("reqToLabel")}</label>
            <input id={`${uid}-e`} className="req-to" type="email" readOnly value={request.email} />
          </div>
          <div className="ad-fld">
            <label htmlFor={`${uid}-n`}>{t("reqNoteLabel")} <small>{t("reqNoteOptional")}</small></label>
            <textarea
              id={`${uid}-n`}
              value={note}
              maxLength={INVITE_NOTE_MAX}
              dir="auto"
              autoComplete="off"
              spellCheck
              aria-describedby={`${uid}-h ${uid}-c`}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="cr">
              <span id={`${uid}-h`}>{t("reqNoteHint")}</span>
              <span id={`${uid}-c`} className={`n${n >= INVITE_NOTE_MAX - 20 ? " near" : ""}`}>{t("reqNoteCount", { n })}</span>
            </div>
          </div>
          {error && (
            <div className="req-err" role="alert">
              <p>{t(error)}</p>
              {stale && <button type="button" className="btn sm" onClick={close}>{t("reqRefresh")}</button>}
            </div>
          )}
          <div className="pe-acts">
            <button type="button" className="btn" onClick={close} disabled={busy}>{t("cancel")}</button>
            {!stale && (
              <button type="button" className="btn primary" disabled={busy || over} onClick={() => void send()}>
                {busy ? t("reqSending") : t(mode === "invite-again" ? "reqInviteAgain" : "reqSend")}
              </button>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
