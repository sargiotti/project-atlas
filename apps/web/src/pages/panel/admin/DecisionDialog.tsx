import { useId, useState } from "react";
import { REASON_MAX, cleanReason, codePointLength } from "@atlas/contract";
import type { FailCode } from "../../../api/publication";
import { useI18n } from "../../../i18n/I18nProvider";
import { Dialog } from "../events/common";

/** Reject and Admin unpublish: an optional reason (plain text) and a confirm. No `maxlength`: the counter counts
 * Unicode code points of the cleaned text, exactly like the server, and blocks the button past 200. */
export default function DecisionDialog({
  title,
  text,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  text: string;
  confirmLabel: string;
  onClose: () => void;
  /** Returns the failure to show inside the dialog, or null when it handled the outcome itself. */
  onConfirm: (reason: string) => Promise<FailCode | "error" | null>;
}) {
  const { t } = useI18n();
  const uid = useId().replace(/:/g, "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = codePointLength(cleanReason(reason));
  const over = n > REASON_MAX;

  const run = async () => {
    if (over || busy) return;
    setBusy(true);
    setError(null);
    const failed = await onConfirm(reason);
    setBusy(false);
    if (failed) setError(failed === "too_long" ? t("adReasonTooLong") : t("adFailed"));
  };

  return (
    <Dialog titleId={`${uid}-t`} descId={`${uid}-d`} initialFocus={() => document.getElementById(`${uid}-r`)} onClose={onClose}>
      <h2 id={`${uid}-t`}>{title}</h2>
      <p className="pe-dlgp" id={`${uid}-d`}>{text}</p>
      <div className="ad-fld">
        <label htmlFor={`${uid}-r`}>{t("adReasonLabel")} <small>{t("adReasonOptional")}</small></label>
        <textarea
          id={`${uid}-r`}
          value={reason}
          dir="auto"
          autoComplete="off"
          spellCheck
          aria-describedby={`${uid}-h ${uid}-c`}
          aria-invalid={over || undefined}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="cr">
          <span id={`${uid}-h`}>{t("adReasonHint")}</span>
          <span id={`${uid}-c`} className={`n${over ? " over" : n >= REASON_MAX - 20 ? " near" : ""}`} aria-label={t("adReasonLimitSr", { n })}>
            {t("adReasonCount", { n })}
          </span>
        </div>
        {over && <p className="err" role="alert">{t("adReasonTooLong")}</p>}
        {error && !over && <p className="err" role="alert">{error}</p>}
      </div>
      <div className="pe-acts">
        <button type="button" className="btn" onClick={onClose}>{t("cancel")}</button>
        <button type="button" className="btn danger solid" disabled={over || busy} onClick={() => void run()}>{confirmLabel}</button>
      </div>
    </Dialog>
  );
}
