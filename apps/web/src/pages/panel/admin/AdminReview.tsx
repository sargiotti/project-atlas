import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AdminReviewResponse } from "@atlas/contract";
import { adminApprove, adminReject, adminReview, adminUnpublish, type FailCode } from "../../../api/publication";
import { useI18n } from "../../../i18n/I18nProvider";
import { Link, navigate } from "../../../lib/router";
import { Ic, LoadError, Loading, StatusBadge, setFlash, useDocTitle } from "../events/common";
import { PreviewStage } from "../events/EventPreview";
import { shortDate } from "../events/PublishStep";
import { usePending } from "../pending";
import DecisionDialog from "./DecisionDialog";
import { OrganizerLine, relTime } from "./AdminLists";

type Note = "stale" | "gone" | "map" | "points" | "failed" | null;

/**
 * /panel/admin/review/<id>: a read-only preview of the event plus the decision panel. There is no edit or delete
 * control here and the organizer form is never reused: the Admin can only approve, reject or unpublish.
 */
export default function AdminReview({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const { setCount } = usePending();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"loading" | "error" | "gone" | AdminReviewResponse>("loading");
  const [dialog, setDialog] = useState<"reject" | "unpublish" | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  useDocTitle(typeof state === "object" ? `${state.event.name} · ${t("appName")}` : t("appName"));

  useEffect(() => {
    const ctrl = new AbortController();
    setState("loading");
    adminReview(id, ctrl.signal)
      .then((r) => {
        if (r.status === "ok") setState(r.review);
        else if (r.status === "failed" && r.code === "unauthenticated") navigate("/panel/login", true, true);
        else if (r.status === "failed" && r.code === "not_found") setState("gone");
        else setState("error");
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [id, attempt]);

  const rvRef = useRef<HTMLDivElement>(null);
  const loaded = typeof state === "object";
  // Below 1024px the decision bar is sticky at the bottom: size the stage to the room left above it (min 280px).
  useLayoutEffect(() => {
    const root = rvRef.current;
    const stage = root?.querySelector<HTMLElement>(".ad-stage");
    const bar = root?.querySelector<HTMLElement>(".ad-bar");
    if (!root || !stage || !bar) return;
    const mq = window.matchMedia("(max-width: 1023.98px)");
    const fit = () => {
      if (!mq.matches) return root.style.removeProperty("--ad-stage-h");
      const top = stage.getBoundingClientRect().top + window.scrollY;
      const gap = parseFloat(getComputedStyle(stage).marginBottom) || 0;
      const h = document.documentElement.clientHeight - top - bar.offsetHeight - gap;
      root.style.setProperty("--ad-stage-h", `${Math.max(280, Math.floor(h))}px`);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(bar);
    ro.observe(document.documentElement);
    mq.addEventListener("change", fit);
    return () => { ro.disconnect(); mq.removeEventListener("change", fit); };
  }, [loaded, lang, note, rv0(state)]);

  if (state === "loading") return <Loading />;
  if (state === "error") return <LoadError onRetry={() => setAttempt((n) => n + 1)} />;
  if (state === "gone") return <Gone />;
  const data = state;
  const rv = data.review;
  const name = data.event.name;

  const finish = (text: string, count: number) => {
    setCount(count);
    setFlash({ kind: "msg", name: text });
    navigate(rv.status === "published" ? "/panel/admin/published" : "/panel/admin/pending", false, true);
  };

  /** Maps a failed decision to the note on the panel. Returns true when the screen handled it. */
  const handleFail = (code: FailCode | "error"): boolean => {
    if (code === "unauthenticated") navigate("/panel/login", true, true);
    else if (code === "event_changed") setNote("stale");
    else if (code === "invalid_transition" || code === "not_found") setNote("gone");
    else if (code === "map_required") setNote("map");
    else if (code === "points_required") setNote("points");
    else return false;
    return true;
  };

  const approve = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    const r = await adminApprove(id, rv.updatedAt);
    setBusy(false);
    if (r.status === "ok") return finish(t("adApproved", { name }), r.pendingCount);
    if (!handleFail(r.status === "failed" ? r.code : "error")) setNote("failed");
  };

  const decide = (kind: "reject" | "unpublish") => async (reason: string) => {
    const r = await (kind === "reject" ? adminReject(id, reason) : adminUnpublish(id, reason));
    if (r.status === "ok") {
      finish(kind === "reject" ? t("adRejected", { name }) : t("adUnpublished", { name }), r.pendingCount);
      return null;
    }
    const code = r.status === "failed" ? r.code : "error";
    if (code === "too_long") return code;
    if (handleFail(code)) {
      setDialog(null);
      return null;
    }
    return code;
  };

  return (
    <div>
      <div className="ad-banner" role="region" aria-label={t("adPreviewBanner")}>
        <Ic n="eye" />
        <span>{t("adPreviewBanner")}</span>
      </div>
      <div className="pe-page" style={{ paddingBottom: 0 }}>
        <Link to={rv.status === "published" ? "/panel/admin/published" : "/panel/admin/pending"} className="pe-back">
          <Ic n="left" size={18} />{rv.status === "published" ? t("adBackPublished") : t("adBackPending")}
        </Link>
      </div>
      <div className="ad-rv" ref={rvRef}>
        <div className="ad-stage">
          <PreviewStage data={data} />
        </div>
        <aside className="ad-bar" aria-labelledby="ad-decision">
          <h2 id="ad-decision">{t("adDecision")}</h2>
          <div className="tags"><StatusBadge status={rv.status} />{rv.editedSinceApproval && <span className="st st-edited">{t("adEditedSince")}</span>}</div>
          <div className="who">
            {rv.status === "published" ? (
              <span>{t("adPublishedState", { date: shortDate(rv.approvedAt, lang) })}</span>
            ) : (
              <span>{t("adRequestedBy", { rel: relTime(rv.requestedAt, lang) })}</span>
            )}
            <span className="org"><OrganizerLine organizer={rv.organizer} /></span>
          </div>
          {note && <NoteBox note={note} onReload={() => { setNote(null); setAttempt((n) => n + 1); }} />}
          {rv.status === "in_review" ? (
            <div className="acts">
              <button type="button" className="btn primary" disabled={busy} onClick={() => void approve()}>
                <Ic n="check" size={18} />{busy ? t("adApproving") : t("adApprove")}
              </button>
              <button type="button" className="btn danger" disabled={busy} onClick={() => setDialog("reject")}>{t("adReject")}</button>
            </div>
          ) : (
            <div className="acts">
              <button type="button" className="btn danger" disabled={busy} onClick={() => setDialog("unpublish")}>{t("adUnpublish")}</button>
            </div>
          )}
        </aside>
      </div>
      {dialog === "reject" && (
        <DecisionDialog title={t("adRejT", { name })} text={t("adRejS")} confirmLabel={t("adRejBtn")} onClose={() => setDialog(null)} onConfirm={decide("reject")} />
      )}
      {dialog === "unpublish" && (
        <DecisionDialog title={t("adUnpubT", { name })} text={t("adUnpubS")} confirmLabel={t("adUnpubBtn")} onClose={() => setDialog(null)} onConfirm={decide("unpublish")} />
      )}
    </div>
  );
}

/** Re-fit when the event under review (and so the bar contents) changes. */
function rv0(state: unknown) {
  return typeof state === "object" && state ? (state as AdminReviewResponse).review.status : "";
}

function NoteBox({ note, onReload }: { note: Exclude<Note, null>; onReload: () => void }) {
  const { t } = useI18n();
  if (note === "stale") {
    return (
      <div className="ad-note" role="alert">
        <b>{t("adStaleT")}</b>
        <span>{t("adStaleS")}</span>
        <button type="button" className="btn sm" onClick={onReload}><Ic n="swap" size={16} />{t("adReload")}</button>
      </div>
    );
  }
  if (note === "gone") {
    return (
      <div className="ad-note err" role="alert">
        <b>{t("adGoneT")}</b>
        <span>{t("adGoneS")}</span>
        <Link to="/panel/admin/pending" className="btn sm">{t("adBackToPending")}</Link>
      </div>
    );
  }
  return <div className="ad-note err" role="alert"><b>{note === "map" ? t("adMapMissing") : note === "points" ? t("adPointsMissing") : t("adFailed")}</b></div>;
}

function Gone() {
  const { t } = useI18n();
  return (
    <div className="status-card">
      <h1>{t("adGoneT")}</h1>
      <p>{t("adGoneS")}</p>
      <Link to="/panel/admin/pending" className="btn primary">{t("adBackToPending")}</Link>
    </div>
  );
}
