import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { DEFAULT_REQUEST_FILTER, REQUEST_FILTERS, type OrganizerRequestRow, type OrganizerRequestSummary, type RequestFilter } from "@atlas/contract";
import { getRequestSummary, listOrganizerRequests, requestAction } from "../../../api/organizerRequest";
import { useI18n } from "../../../i18n/I18nProvider";
import type { MessageKey } from "../../../i18n/messages";
import { Link, navigate } from "../../../lib/router";
import { NoAccess } from "../PanelGuard";
import { Ic, Toast, useDocTitle } from "../events/common";
import InviteRequestDialog from "./InviteRequestDialog";

const emailOk = z.email();

/** A mailto link is built only from a value that passes email validation; anything else is shown as plain text. */
function Mail({ value }: { value: string }) {
  if (!emailOk.safeParse(value).success) return <>{value}</>;
  return <a href={`mailto:${encodeURIComponent(value).replace(/%40/g, "@")}`}>{value}</a>;
}

type State = { kind: "loading" | "error" | "forbidden" } | { kind: "ok"; rows: OrganizerRequestRow[]; next: string | null };

/** The filter comes from the URL (?status=) and is validated against the contract list; anything else is the default. */
function readFilter(): RequestFilter {
  try {
    const v = new URLSearchParams(window.location.search).get("status");
    return (REQUEST_FILTERS as readonly string[]).includes(v ?? "") ? (v as RequestFilter) : DEFAULT_REQUEST_FILTER;
  } catch {
    return DEFAULT_REQUEST_FILTER;
  }
}

/** Counts box (slice 44). Refs and languages are rendered only as React text, never in an href, title, class or style. */
function Summary({ data }: { data: OrganizerRequestSummary }) {
  const { t } = useI18n();
  const win = (title: MessageKey, w: OrganizerRequestSummary["last7d"]) => {
    const langs = [["ES", w.byLang.es], ["CA", w.byLang.ca], ["EN", w.byLang.en], ["DA", w.byLang.da], ["—", w.byLang.none]] as const;
    return (
      <section className="req-sum-win">
        <h2>{t(title)}</h2>
        <p className="req-sum-total"><b>{w.total}</b> {t("reqSumUnit")}</p>
        <dl className="req-fields">
          <div><dt>{t("reqSumLang")}</dt><dd>{langs.filter(([, n]) => n > 0).map(([l, n]) => `${l} ${n}`).join(" · ") || t("reqNone")}</dd></div>
          <div>
            <dt>{t("reqSumRef")}</dt>
            <dd>
              {[
                ...w.byRef.top.map((r) => `${r.ref} ${r.count}`),
                ...(w.byRef.other ? [`${t("reqSumOther")} ${w.byRef.other}`] : []),
                ...(w.byRef.none ? [`${t("reqDirect")} ${w.byRef.none}`] : []),
              ].join(" · ") || t("reqNone")}
            </dd>
          </div>
        </dl>
      </section>
    );
  };
  return (
    <div className="req-sum" aria-label={t("reqSumTitle")} role="group">
      {win("reqSum7", data.last7d)}
      {win("reqSum30", data.last30d)}
    </div>
  );
}

/**
 * Admin list of organizer requests (slice 30) with the invite actions of slice 31. Every field is rendered as React text:
 * no HTML injection and the message is never turned into links. The server enforces access (401/403) and every
 * transition; the buttons shown here are UX only.
 */
export default function AdminRequests() {
  const { t, lang } = useI18n();
  useDocTitle(`${t("reqTitle")} · ${t("appName")}`);
  const [filter, setFilter] = useState<RequestFilter>(readFilter);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [more, setMore] = useState<"idle" | "busy" | "failed">("idle");
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<{ row: OrganizerRequestRow; mode: "invite" | "invite-again" } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; key: MessageKey } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [summary, setSummary] = useState<OrganizerRequestSummary | null>(null);
  const fmt = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" });
  const day = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" });

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: "loading" });
    listOrganizerRequests(null, ctrl.signal, filter)
      .then((r) => {
        if (r.status === "unauthenticated") navigate("/panel/login", true);
        else if (r.status === "ok") setState({ kind: "ok", rows: r.page.requests, next: r.page.nextCursor });
        else setState({ kind: r.status });
      })
      .catch(() => {}); // aborted
    return () => ctrl.abort();
  }, [attempt, filter]);

  useEffect(() => {
    const ctrl = new AbortController();
    void getRequestSummary(ctrl.signal).then((r) => !ctrl.signal.aborted && setSummary(r));
    return () => ctrl.abort();
  }, []);

  const pickFilter = (f: RequestFilter) => {
    if (f === filter) return;
    setFilter(f);
    setRowError(null);
    try {
      const u = new URL(window.location.href);
      if (f === DEFAULT_REQUEST_FILTER) u.searchParams.delete("status");
      else u.searchParams.set("status", f);
      window.history.replaceState(window.history.state, "", u);
    } catch {
      // the URL is a convenience
    }
  };

  const loadMore = useCallback(async () => {
    if (state.kind !== "ok" || !state.next || more === "busy") return;
    setMore("busy");
    const r = await listOrganizerRequests(state.next, undefined, filter);
    if (r.status === "ok") {
      setState((s) => (s.kind === "ok" ? { kind: "ok", rows: [...s.rows, ...r.page.requests.filter((n) => !s.rows.some((o) => o.id === n.id))], next: r.page.nextCursor } : s));
      setMore("idle");
    } else setMore("failed");
  }, [state, more, filter]);

  /** Replace the row with the server's version; it leaves the list when it no longer matches the filter. */
  const applyRow = (row: OrganizerRequestRow) =>
    setState((s) =>
      s.kind !== "ok" ? s : { ...s, rows: s.rows.flatMap((r) => (r.id !== row.id ? [r] : filter === "all" || row.status === filter ? [row] : [])) },
    );

  const simple = async (row: OrganizerRequestRow, action: "discard" | "restore") => {
    if (busyId) return;
    setBusyId(row.id);
    setRowError(null);
    const r = await requestAction(row.id, action);
    setBusyId(null);
    if (r.status === "unauthenticated") return navigate("/panel/login", true);
    if (r.status === "ok") {
      applyRow(r.request);
      setToast(t(action === "discard" ? "reqDiscardedToast" : "reqRestoredToast"));
    } else if (r.status === "failed" && (r.code === "invalid_transition" || r.code === "not_found")) setRowError({ id: row.id, key: "reqErrStale" });
    else setRowError({ id: row.id, key: "reqActionFailed" });
  };

  if (state.kind === "forbidden") return <NoAccess />;
  const field = (label: MessageKey, v: string | null) => (
    <div><dt>{t(label)}</dt><dd>{v ? v : t("reqNone")}</dd></div>
  );

  const badge = (r: OrganizerRequestRow) => {
    const info =
      r.status === "invited" && r.invitedAt
        ? t(r.inviteExpiresAt && r.inviteExpiresAt < Date.now() ? "reqInvitedExpired" : "reqInvitedInfo", {
            date: day.format(new Date(r.invitedAt)),
            exp: r.inviteExpiresAt ? day.format(new Date(r.inviteExpiresAt)) : "—",
          })
        : null;
    return (
      <div className="req-state">
        <span className={`req-badge ${r.status}`}>{t(`reqBadge_${r.status}` as MessageKey)}</span>
        {info && <span className="req-sub">{info}</span>}
      </div>
    );
  };

  return (
    <div className="pe-page req-page">
      <Link to="/panel" className="pe-back"><Ic n="left" size={18} />{t("myEvents")}</Link>
      <div className="ad-head"><h1>{t("reqTitle")}</h1></div>
      <p className="ad-lead">{t("reqLead")}</p>
      {summary && <Summary data={summary} />}
      <div className="req-filter" role="group" aria-label={t("reqFilterLabel")}>
        {REQUEST_FILTERS.map((f) => (
          <button key={f} type="button" className="req-chip" aria-pressed={filter === f} onClick={() => pickFilter(f)}>
            {t(`reqFilter_${f}` as MessageKey)}
          </button>
        ))}
      </div>
      {state.kind === "loading" && <p className="loading" role="status">{t("reqLoading")}</p>}
      {state.kind === "error" && (
        <div className="state">
          <p className="muted" role="alert">{t("reqError")}</p>
          <button type="button" className="btn primary" onClick={() => setAttempt((n) => n + 1)}>{t("retry")}</button>
        </div>
      )}
      {state.kind === "ok" && state.rows.length === 0 && (
        <div className="ad-empty"><b>{filter === "pending" || filter === "all" ? t("reqEmpty") : t("reqFiltered")}</b></div>
      )}
      {state.kind === "ok" && state.rows.length > 0 && (
        <ul className="ad-list">
          {state.rows.map((r) => (
            <li key={r.id} className="req-row">
              <div className="req-top">
                <h3>{r.eventName}</h3>
                {badge(r)}
              </div>
              <p className="req-meta">
                <span>{r.name} · <Mail value={r.email} /></span>
                <span>{fmt.format(new Date(r.createdAt))} · {t("reqEmailSent")}: {t(`reqStatus_${r.emailStatus}` as MessageKey)}</span>
              </p>
              <dl className="req-fields">
                {field("reqDate", r.eventDate)}
                {field("reqCity", r.city)}
                {field("reqLangLbl", r.pageLang ? r.pageLang.toUpperCase() : null)}
                <div><dt>{t("reqRefLbl")}</dt><dd>{r.sourceRef ?? t("reqDirect")}</dd></div>
                {field("reqRole", r.role)}
              </dl>
              {r.message && (
                <div>
                  <b className="req-lbl">{t("reqMessage")}</b>
                  <p className="req-msg">{r.message}</p>
                </div>
              )}
              {r.status !== "joined" && (
                <div className="req-acts">
                  {r.status === "pending" && (
                    <>
                      <button type="button" className="btn primary sm" aria-label={`${t("reqInvite")}: ${r.name}`} disabled={busyId === r.id} onClick={() => setDialog({ row: r, mode: "invite" })}>{t("reqInvite")}</button>
                      <button type="button" className="btn sm" aria-label={`${t("reqDiscard")}: ${r.name}`} disabled={busyId === r.id} onClick={() => void simple(r, "discard")}>{t("reqDiscard")}</button>
                    </>
                  )}
                  {r.status === "invited" && (
                    <button type="button" className="btn primary sm" aria-label={`${t("reqInviteAgain")}: ${r.name}`} onClick={() => setDialog({ row: r, mode: "invite-again" })}>{t("reqInviteAgain")}</button>
                  )}
                  {r.status === "discarded" && (
                    <button type="button" className="btn sm" aria-label={`${t("reqRestore")}: ${r.name}`} disabled={busyId === r.id} onClick={() => void simple(r, "restore")}>{t("reqRestore")}</button>
                  )}
                </div>
              )}
              {rowError?.id === r.id && (
                <p className="hint bad" role="alert">
                  {t(rowError.key)}{" "}
                  {rowError.key === "reqErrStale" && <button type="button" className="btn sm" onClick={() => { setRowError(null); setAttempt((n) => n + 1); }}>{t("reqRefresh")}</button>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {state.kind === "ok" && state.next && (
        <div className="ad-more">
          <button type="button" className="btn" onClick={loadMore} disabled={more === "busy"}>{t("reqMore")}</button>
        </div>
      )}
      {more === "failed" && <p className="hint bad" role="alert">{t("reqMoreFailed")}</p>}
      {dialog && (
        <InviteRequestDialog
          key={dialog.row.id}
          request={dialog.row}
          mode={dialog.mode}
          onChanged={(row, sent) => {
            applyRow(row);
            if (sent) setToast(t("reqSentToast", { email: row.email }));
          }}
          onStale={() => setAttempt((n) => n + 1)}
          onClose={() => setDialog(null)}
        />
      )}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
