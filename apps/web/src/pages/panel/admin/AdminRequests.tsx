import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import type { OrganizerRequestRow } from "@atlas/contract";
import { listOrganizerRequests } from "../../../api/organizerRequest";
import { useI18n } from "../../../i18n/I18nProvider";
import type { MessageKey } from "../../../i18n/messages";
import { navigate } from "../../../lib/router";
import { NoAccess } from "../PanelGuard";
import { useDocTitle } from "../events/common";

const emailOk = z.email();

/** A mailto link is built only from a value that passes email validation; anything else is shown as plain text. */
function Mail({ value }: { value: string }) {
  if (!emailOk.safeParse(value).success) return <>{value}</>;
  return <a href={`mailto:${encodeURIComponent(value).replace(/%40/g, "@")}`}>{value}</a>;
}

type State = { kind: "loading" | "error" | "forbidden" } | { kind: "ok"; rows: OrganizerRequestRow[]; next: string | null };

/**
 * Admin-only, read-only list of organizer requests (slice 30). Every field is rendered as React text: no HTML injection and the
 * message is never turned into links. The server enforces access (401/403); the menu entry being admin-only is cosmetic.
 */
export default function AdminRequests() {
  const { t, lang } = useI18n();
  useDocTitle(`${t("reqTitle")} · ${t("appName")}`);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [more, setMore] = useState<"idle" | "busy" | "failed">("idle");
  const [attempt, setAttempt] = useState(0);
  const fmt = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" });

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: "loading" });
    listOrganizerRequests(null, ctrl.signal)
      .then((r) => {
        if (r.status === "unauthenticated") navigate("/panel/login", true);
        else if (r.status === "ok") setState({ kind: "ok", rows: r.page.requests, next: r.page.nextCursor });
        else setState({ kind: r.status });
      })
      .catch(() => {}); // aborted
    return () => ctrl.abort();
  }, [attempt]);

  const loadMore = useCallback(async () => {
    if (state.kind !== "ok" || !state.next || more === "busy") return;
    setMore("busy");
    const r = await listOrganizerRequests(state.next);
    if (r.status === "ok") {
      setState((s) => (s.kind === "ok" ? { kind: "ok", rows: [...s.rows, ...r.page.requests.filter((n) => !s.rows.some((o) => o.id === n.id))], next: r.page.nextCursor } : s));
      setMore("idle");
    } else setMore("failed");
  }, [state, more]);

  if (state.kind === "forbidden") return <NoAccess />;
  const field = (label: MessageKey, v: string | null) => (
    <div><dt>{t(label)}</dt><dd>{v ? v : t("reqNone")}</dd></div>
  );

  return (
    <div className="pe-page">
      <div className="ad-head"><h1>{t("reqTitle")}</h1></div>
      <p className="ad-lead">{t("reqLead")}</p>
      {state.kind === "loading" && <p className="loading" role="status">{t("reqLoading")}</p>}
      {state.kind === "error" && (
        <div className="state">
          <p className="muted" role="alert">{t("reqError")}</p>
          <button type="button" className="btn primary" onClick={() => setAttempt((n) => n + 1)}>{t("retry")}</button>
        </div>
      )}
      {state.kind === "ok" && state.rows.length === 0 && (
        <div className="ad-empty"><b>{t("reqEmpty")}</b></div>
      )}
      {state.kind === "ok" && state.rows.length > 0 && (
        <ul className="ad-list">
          {state.rows.map((r) => (
            <li key={r.id} className="req-row">
              <h3>{r.eventName}</h3>
              <p className="req-meta">
                <span>{r.name} · <Mail value={r.email} /></span>
                <span>{fmt.format(new Date(r.createdAt))} · {t("reqEmailSent")}: {t(`reqStatus_${r.emailStatus}` as MessageKey)}</span>
              </p>
              <dl className="req-fields">
                {field("reqDate", r.eventDate)}
                {field("reqCity", r.city)}
                {field("reqRole", r.role)}
              </dl>
              {r.message && (
                <div>
                  <b className="req-lbl">{t("reqMessage")}</b>
                  <p className="req-msg">{r.message}</p>
                </div>
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
    </div>
  );
}
