import { useId, useRef, useState } from "react";
import type { PanelEvent } from "@atlas/contract";
import { organizerTransition, type FailCode } from "../../../api/publication";
import { useI18n } from "../../../i18n/I18nProvider";
import { Link, navigate } from "../../../lib/router";
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
 * The publishing status band inside the event card (slice 29): the 3-step guide while not published, a one-line fact once published. The buttons only ask; the server decides which transition is legal
 * and the answer (the event) replaces what the hub shows. Editing stays available in every status.
 */
export default function PublishStep({
  event: e,
  onEvent,
  onReload,
  onNotice,
  extra,
}: {
  event: PanelEvent;
  onEvent: (e: PanelEvent) => void;
  onReload: () => void;
  onNotice: (text: string) => void;
  extra?: React.ReactNode;
}) {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const band = useRef<HTMLElement>(null);
  const [needPoints, setNeedPoints] = useState(false);

  const explain = (code: FailCode | "error") => {
    if (code === "unauthenticated") return void navigate("/panel/login", true, true);
    if (code === "invalid_transition" || code === "event_changed" || code === "not_found") {
      setError(t("pePubStale"));
      onReload();
    } else if (code === "map_required") {
      setError(t("pePubNeedMap"));
      onReload();
    } else if (code === "points_required") {
      setError(t("pePubNeedPoints"));
      setNeedPoints(true);
    } else if (code === "transition_cap_reached") setError(t("pePubCap"));
    else if (code === "rate_limited") setError(t("pePubRate"));
    else if (code === "validation") setError(t("pePubInvalid"));
    else setError(t("pePubFailed"));
  };

  const run = async (action: "publish-request" | "withdraw" | "unpublish", okText: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNeedPoints(false);
    const r = await organizerTransition(e.id, action);
    setBusy(false);
    if (r.status === "ok") {
      setConfirming(false);
      onEvent(r.event);
      onNotice(okText);
      requestAnimationFrame(() => band.current?.focus());
    } else {
      setConfirming(false);
      explain(r.status === "failed" ? r.code : "error");
    }
  };

  const request = (label: string, aria?: string) => (
    <button type="button" className="btn primary" disabled={busy} aria-label={aria} onClick={() => void run("publish-request", t("pePubRequestedSr"))}>
      <Ic n="upload" size={18} />{busy ? t("pePubSending") : label}
    </button>
  );
  const fail = error && (
    <>
      <p className="pe-pubnote err" role="alert">{error}</p>
      {needPoints && (
        <p><Link to={`/panel/events/${e.id}/points`} className="btn sm"><Ic n="pin" size={16} />{t("pePubPlacePoints")}</Link></p>
      )}
    </>
  );
  const reason = (label: string) => (
    <p className="pe-reason" dir="auto">
      <span>{label}</span>
      {e.statusReason ?? t("pePubNoReason")}
    </p>
  );

  const step = (cls: string, node: React.ReactNode, title: string, sub: string) => (
    <li className={cls}>
      <span className="node">{node}</span>
      <div><b>{title}</b>{sub && <small>{sub}</small>}</div>
    </li>
  );
  const stepper = (mapDone: boolean, s3Cls: string, s3Node: React.ReactNode) => (
    <ol className="pe-stepper">
      {step("done", <Ic n="check" size={16} />, t("peStep1"), t("peStep1Done"))}
      {mapDone
        ? step("done", <Ic n="check" size={16} />, t("peStep2"), t("peStep1Done"))
        : step("now", "2", t("peStep2"), t("peStep2Now"))}
      {step(s3Cls, s3Node, t("peStep3"), "")}
    </ol>
  );

  let body: React.ReactNode;
  let draft = false;
  if (e.status === "draft") {
    draft = true;
    body = !e.map ? (
      <>
        {stepper(false, "lock", <Ic n="lock" size={16} />)}
        <div className="pe-bandmsg">
          <p className="muted">{t("pePubNeedMapSub")}</p>
          <p>{t("pePubNeedMap")}</p>
        </div>
        <div className="pe-bandact"><button type="button" className="btn primary" disabled><Ic n="upload" size={18} />{t("pePubRequest")}</button></div>
      </>
    ) : (
      <>
        {stepper(true, "now", "3")}
        <div className="pe-bandmsg">
          <p className="muted">{t("pePubNow")}</p>
          <p>{t("pePubExplain")}</p>
        </div>
        <div className="pe-bandact">{request(t("pePubRequest"))}</div>
      </>
    );
  } else if (e.status === "in_review") {
    body = (
      <div className="pe-notice">
        <div className="s3h"><StatusBadge status={e.status} /><span className="muted">{t("pePubRequestedAt", { date: shortDate(e.requestedAt, lang) })}</span></div>
        <p><b>{t("pePubWaitingT")}</b> {t("pePubWaitingS")}</p>
        <p className="muted">{t("pePubKeepEditing")}</p>
        <div className="pe-brow">
          <button type="button" className="btn" disabled={busy} onClick={() => void run("withdraw", t("pePubWithdrawn"))}>
            <Ic n="undo" size={18} />{t("pePubWithdraw")}
          </button>
        </div>
      </div>
    );
  } else if (e.status === "published") {
    body = (
      <div className="pe-pubrow">
        <StatusBadge status={e.status} />
        <div className="pe-bandmsg">
          <p><b>{t("pePubSince", { date: shortDate(e.approvedAt, lang) })}</b></p>
          <p className="muted">{t("pePubEditsLive")}</p>
        </div>
        <button type="button" className="btn quiet" disabled={busy} onClick={() => setConfirming(true)}>{t("pePubUnpublish")}</button>
        {confirming && (
          <UnpublishDialog busy={busy} onClose={() => setConfirming(false)} onConfirm={() => void run("unpublish", t("pePubUnpublished"))} />
        )}
      </div>
    );
  } else if (e.status === "rejected") {
    body = (
      <div className="pe-notice rej">
        <div className="s3h"><StatusBadge status={e.status} /></div>
        <p><b>{t("pePubRejT")}</b></p>
        {reason(t("pePubReasonLabel"))}
        <p>{t("pePubRejNext")}</p>
        <div className="pe-brow">{request(t("pePubRequestAgain"), t("pePubRequestAgainLabel"))}</div>
      </div>
    );
  } else {
    // unpublished_admin
    body = (
      <div className="pe-notice">
        <div className="s3h"><StatusBadge status={e.status} /></div>
        <p><b>{t("pePubAdminUnpubT")}</b> {t("pePubAdminUnpubS")}</p>
        {reason(t("pePubReasonLabel"))}
        <p>{t("pePubAdminUnpubNext")}</p>
        <div className="pe-brow">{request(t("pePubRequestAgain"), t("pePubRequestAgainLabel"))}</div>
      </div>
    );
  }

  return (
    <section className={`pe-band${draft ? " draft" : ""}`} aria-labelledby={`${e.id}-band`} tabIndex={-1} ref={band}>
      <h2 id={`${e.id}-band`} className={draft ? "pe-bandtitle" : "pe-vh"}>{t("pePathTitle")}</h2>
      {body}
      {fail}
      {extra}
    </section>
  );
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
