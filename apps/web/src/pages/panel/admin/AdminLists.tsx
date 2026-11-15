import { useCallback, useEffect, useState } from "react";
import type { AdminEventRow } from "@atlas/contract";
import { adminList, adminUnpublish } from "../../../api/publication";
import { useI18n } from "../../../i18n/I18nProvider";
import { Link, navigate } from "../../../lib/router";
import { Ic, LoadError, Loading, StatusBadge, Toast, dateRange, useDocTitle, useFlashToast } from "../events/common";
import DecisionDialog from "./DecisionDialog";
import { usePending } from "../pending";

export function relTime(iso: string | null, lang: string) {
  if (!iso) return "";
  const diff = new Date(iso).getTime() - Date.now();
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["day", 864e5], ["hour", 36e5], ["minute", 6e4]];
  try {
    const f = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
    for (const [u, ms] of units) if (Math.abs(diff) >= ms) return f.format(Math.round(diff / ms), u);
    return f.format(0, "minute");
  } catch {
    return iso.slice(0, 10);
  }
}

export function OrganizerLine({ organizer }: { organizer: { displayName: string; email: string } | null }) {
  const { t } = useI18n();
  if (!organizer) return <span>{t("adDemoEvent")}</span>;
  return (
    <>
      <span dir="auto">{organizer.displayName}</span>
      <span className="em" dir="auto">{organizer.email}</span>
    </>
  );
}

function Tabs({ current }: { current: "pending" | "published" }) {
  const { t } = useI18n();
  const { count } = usePending();
  return (
    <nav className="ad-tabs" aria-label={t("adNav")}>
      <Link to="/panel/admin/pending" aria-current={current === "pending" ? "page" : undefined}>
        {t("adTabPending")}
        {count > 0 && <span className="pa-cnt" aria-label={t("adWaitingSr", { n: count })}>{count}</span>}
      </Link>
      <Link to="/panel/admin/published" aria-current={current === "published" ? "page" : undefined}>{t("adTabPublished")}</Link>
    </nav>
  );
}

/** /panel/admin/pending and /panel/admin/published. The server orders them: Pending oldest request first,
 * Published by last edit. Role gating here is UX only; every call is checked again by the server. */
export default function AdminList({ kind }: { kind: "pending" | "published" }) {
  const { t, lang } = useI18n();
  const { setCount } = usePending();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"loading" | "error" | "forbidden" | { rows: AdminEventRow[]; total: number; next: string | null }>("loading");
  const [more, setMore] = useState<"idle" | "busy" | "error">("idle");
  const [target, setTarget] = useState<AdminEventRow | null>(null);
  const [localToast, setToast] = useState<string | null>(null);
  const { toast: flashToast, clearToast } = useFlashToast();
  const toast = localToast ?? flashToast;
  useDocTitle(`${kind === "pending" ? t("adTabPending") : t("adTabPublished")} · ${t("appName")}`);

  useEffect(() => {
    const ctrl = new AbortController();
    setState("loading");
    adminList(kind, null, ctrl.signal)
      .then((r) => {
        if (r.status === "ok") {
          setState({ rows: r.events, total: r.total, next: r.nextCursor });
          if (kind === "pending") setCount(r.total);
        } else if (r.status === "failed" && r.code === "unauthenticated") navigate("/panel/login", true, true);
        else setState(r.status === "failed" && r.code === "forbidden" ? "forbidden" : "error");
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [kind, attempt, setCount]);

  const loadMore = useCallback(async () => {
    if (typeof state !== "object" || !state.next) return;
    setMore("busy");
    const r = await adminList(kind, state.next);
    if (r.status !== "ok") return setMore("error");
    setMore("idle");
    setState((s) => (typeof s === "object" ? { rows: [...s.rows, ...r.events.filter((e) => !s.rows.some((x) => x.id === e.id))], total: r.total, next: r.nextCursor } : s));
    if (kind === "pending") setCount(r.total);
  }, [state, kind, setCount]);

  if (state === "loading") return <Loading />;
  if (state === "forbidden") return <LoadError onRetry={() => setAttempt((n) => n + 1)} />;
  if (state === "error") return <LoadError onRetry={() => setAttempt((n) => n + 1)} />;

  const unpublish = async (reason: string) => {
    if (!target) return null;
    const r = await adminUnpublish(target.id, reason);
    if (r.status === "ok") {
      const name = target.name;
      setCount(r.pendingCount);
      setState((s) => (typeof s === "object" ? { ...s, rows: s.rows.filter((x) => x.id !== target.id), total: Math.max(0, s.total - 1) } : s));
      setTarget(null);
      setToast(t("adUnpublished", { name }));
      return null;
    }
    if (r.status === "failed" && r.code === "unauthenticated") {
      navigate("/panel/login", true, true);
      return null;
    }
    if (r.status === "failed" && (r.code === "invalid_transition" || r.code === "not_found")) {
      setTarget(null);
      setAttempt((n) => n + 1);
      return null;
    }
    return r.status === "failed" ? r.code : "error";
  };

  return (
    <div className="pe-page">
      <div className="ad-head"><h1>{kind === "pending" ? t("adTabPending") : t("adTabPublished")}</h1></div>
      <Tabs current={kind} />
      <p className="ad-lead">{kind === "pending" ? t("adPendingLead") : t("adPublishedSort")}</p>
      {state.rows.length === 0 ? (
        <div className="ad-empty">
          <Ic n={kind === "pending" ? "check" : "globe"} size={36} />
          <b>{kind === "pending" ? t("adPendingEmptyT") : t("adPublishedEmptyT")}</b>
          <span>{kind === "pending" ? t("adPendingEmptyS") : t("adPublishedEmptyS")}</span>
        </div>
      ) : (
        <ul className="ad-list">
          {state.rows.map((e) => (
            <li key={e.id}>
              <article className="ad-row">
                <div>
                  <h3 dir="auto">{e.name}</h3>
                  <div className="m">
                    <span dir="auto">{dateRange(e.startDate, e.endDate, lang)} · {e.city}</span>
                    <span>{kind === "pending" ? t("adRequestedAgo", { rel: relTime(e.requestedAt, lang) }) : t("adApprovedOn", { date: new Date(e.approvedAt ?? e.updatedAt).toLocaleDateString(lang) })}</span>
                  </div>
                </div>
                <div className="m"><OrganizerLine organizer={e.organizer} /></div>
                <div>
                  <div className="tags">
                    {kind === "published" && <StatusBadge status="published" />}
                    {e.editedSinceApproval && <span className="st st-edited">{t("adEditedSince")}</span>}
                  </div>
                  <div className="acts">
                    <Link to={`/panel/admin/review/${e.id}`} className="btn primary sm" aria-label={t("adReviewOf", { name: e.name })}>
                      <Ic n="eye" size={16} />{t("adReview")}
                    </Link>
                    {kind === "published" && (
                      <button type="button" className="btn danger sm" aria-label={t("adUnpublishOf", { name: e.name })} onClick={() => setTarget(e)}>
                        {t("adUnpublish")}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
      {state.next && (
        <div className="ad-more">
          <button type="button" className="btn" disabled={more === "busy"} onClick={() => void loadMore()}>{t("adMore")}</button>
        </div>
      )}
      {more === "error" && <p className="ad-lead" role="alert">{t("adFailed")}</p>}
      {target && (
        <DecisionDialog
          title={t("adUnpubT", { name: target.name })}
          text={t("adUnpubS")}
          confirmLabel={t("adUnpubBtn")}
          onClose={() => setTarget(null)}
          onConfirm={unpublish}
        />
      )}
      {toast && <Toast text={toast} onDone={() => { setToast(null); clearToast(); }} />}
    </div>
  );
}
