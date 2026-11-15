import { useId, useState } from "react";
import type { PanelEvent } from "@atlas/contract";
import { organizerTransition, type FailCode } from "../../../api/publication";
import ShareDialog, { buildShareUrl } from "../../../components/ShareDialog";
import { useI18n } from "../../../i18n/I18nProvider";
import { navigate } from "../../../lib/router";
import { Dialog, Ic, StatusBadge } from "./common";

export function shortDate(iso: string | null, lang: string) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: "medium" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * Step 3 of the path card, in every status. The buttons only ask; the server decides which transition is legal
 * and the answer (the event) replaces what the hub shows. Editing stays available in every status.
 */
export default function PublishStep({
  event: e,
  onEvent,
  onReload,
  onNotice,
}: {
  event: PanelEvent;
  onEvent: (e: PanelEvent) => void;
  onReload: () => void;
  onNotice: (text: string) => void;
}) {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = buildShareUrl(e.slug);

  const explain = (code: FailCode | "error") => {
    if (code === "unauthenticated") return void navigate("/panel/login", true, true);
    if (code === "invalid_transition" || code === "event_changed" || code === "not_found") {
      setError(t("pePubStale"));
      onReload();
    } else if (code === "map_required") {
      setError(t("pePubNeedMap"));
      onReload();
    } else if (code === "transition_cap_reached") setError(t("pePubCap"));
    else if (code === "rate_limited") setError(t("pePubRate"));
    else if (code === "validation") setError(t("pePubInvalid"));
    else setError(t("pePubFailed"));
  };

  const run = async (action: "publish-request" | "withdraw" | "unpublish", okText: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await organizerTransition(e.id, action);
    setBusy(false);
    if (r.status === "ok") {
      setConfirming(false);
      onEvent(r.event);
      onNotice(okText);
    } else {
      setConfirming(false);
      explain(r.status === "failed" ? r.code : "error");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setSharing(true); // the dialog has a selectable field as the fallback
    }
  };

  const request = (label: string, aria?: string) => (
    <button type="button" className="btn primary" disabled={busy} aria-label={aria} onClick={() => void run("publish-request", t("pePubRequestedSr"))}>
      <Ic n="upload" size={18} />{busy ? t("pePubSending") : label}
    </button>
  );
  const fail = error && <p className="pe-pubnote err" role="alert">{error}</p>;
  const reason = (label: string) => (
    <p className="pe-reason" dir="auto">
      <span>{label}</span>
      {e.statusReason ?? t("pePubNoReason")}
    </p>
  );

  const s3 = (cls: string, node: React.ReactNode, showBadge: boolean, body: React.ReactNode) => (
    <li className={`s3 ${cls}`}>
      <span className="node">{node}</span>
      <div>
        <div className="s3h">
          <b>{t("peStep3")}</b>
          {showBadge && <StatusBadge status={e.status} />}
        </div>
        {body}
        {fail}
      </div>
    </li>
  );

  if (e.status === "draft" && !e.map) {
    return s3("", <Ic n="lock" size={18} />, false, (
      <>
        <p className="muted">{t("pePubNeedMapSub")}</p>
        <p>{t("pePubNeedMap")}</p>
        <div className="pe-brow"><button type="button" className="btn primary" disabled><Ic n="upload" size={18} />{t("pePubRequest")}</button></div>
      </>
    ));
  }
  if (e.status === "draft") {
    return s3("nextstep", "3", false, (
      <>
        <p className="muted">{t("pePubNow")}</p>
        <p>{t("pePubExplain")}</p>
        <div className="pe-brow">{request(t("pePubRequest"))}</div>
      </>
    ));
  }
  if (e.status === "in_review") {
    return s3("n-review", <Ic n="clock" size={18} />, true, (
      <>
        <p className="muted">{t("pePubRequestedAt", { date: shortDate(e.requestedAt, lang) })}</p>
        <p><b>{t("pePubWaitingT")}</b> {t("pePubWaitingS")}</p>
        <p className="muted">{t("pePubKeepEditing")}</p>
        <div className="pe-brow">
          <button type="button" className="btn" disabled={busy} onClick={() => void run("withdraw", t("pePubWithdrawn"))}>
            <Ic n="undo" size={18} />{t("pePubWithdraw")}
          </button>
        </div>
      </>
    ));
  }
  if (e.status === "published") {
    return s3("n-pub", <Ic n="check" size={18} />, true, (
      <>
        <p className="muted">{t("pePubSince", { date: shortDate(e.approvedAt, lang) })}</p>
        <p>{t("pePubLive")}</p>
        <div className="pe-linkbox">
          <code dir="ltr">{url}</code>
          <button type="button" className="btn sm" aria-label={t("pePubCopyLabel")} onClick={() => void copy()}>
            {copied ? <><Ic n="check" size={16} />{t("pePubCopied")}</> : t("pePubCopy")}
          </button>
        </div>
        <div className="pe-brow">
          <button type="button" className="btn" onClick={() => setSharing(true)}>{t("pePubShare")}</button>
          <a className="btn" href={`/e/${e.slug}`} target="_blank" rel="noopener noreferrer" aria-label={t("pePubOpenLabel")}>{t("pePubOpen")}</a>
        </div>
        <p className="muted">{t("pePubEditsLive")}</p>
        <hr className="pe-sep" />
        <div className="pe-brow">
          <button type="button" className="btn danger" disabled={busy} onClick={() => setConfirming(true)}>{t("pePubUnpublish")}</button>
        </div>
        {confirming && (
          <UnpublishDialog busy={busy} onClose={() => setConfirming(false)} onConfirm={() => void run("unpublish", t("pePubUnpublished"))} />
        )}
        {sharing && <ShareDialog slug={e.slug} eventName={e.name} onClose={() => setSharing(false)} />}
      </>
    ));
  }
  if (e.status === "rejected") {
    return s3("n-rej", <Ic n="warn" size={18} />, true, (
      <>
        <p><b>{t("pePubRejT")}</b></p>
        {reason(t("pePubReasonLabel"))}
        <p>{t("pePubRejNext")}</p>
        <div className="pe-brow">{request(t("pePubRequestAgain"), t("pePubRequestAgainLabel"))}</div>
      </>
    ));
  }
  // unpublished_admin
  return s3("n-unpub", <Ic n="lock" size={18} />, true, (
    <>
      <p><b>{t("pePubAdminUnpubT")}</b> {t("pePubAdminUnpubS")}</p>
      {reason(t("pePubReasonLabel"))}
      <p>{t("pePubAdminUnpubNext")}</p>
      <div className="pe-brow">{request(t("pePubRequestAgain"), t("pePubRequestAgainLabel"))}</div>
    </>
  ));
}

function UnpublishDialog({ busy, onClose, onConfirm }: { busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const { t } = useI18n();
  const uid = useId().replace(/:/g, "");
  return (
    <Dialog titleId={`${uid}-t`} descId={`${uid}-d`} initialFocus={() => document.getElementById(`${uid}-cancel`)} onClose={onClose}>
      <h2 id={`${uid}-t`}>{t("pePubUnpubT")}</h2>
      <p className="pe-dlgp" id={`${uid}-d`}>{t("pePubUnpubS")}</p>
      <div className="pe-acts">
        <button type="button" id={`${uid}-cancel`} className="btn" onClick={onClose}>{t("cancel")}</button>
        <button type="button" className="btn danger solid" disabled={busy} onClick={onConfirm}>{t("pePubUnpubBtn")}</button>
      </div>
    </Dialog>
  );
}
