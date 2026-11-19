import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Organizer } from "@atlas/contract";
import LangSwitch from "../../components/LangSwitch";
import { fetchMe, logout } from "../../api/auth";
import { useI18n } from "../../i18n/I18nProvider";
import { Link, navigate } from "../../lib/router";
import { Brand } from "./parts";
import { clearAllDrafts, purgeForeignDrafts } from "../../lib/draftStorage";
import { clearCoverHandoff } from "../../lib/coverHandoff";
import { MeContext, PendingContext, usePending } from "./pending";

export function initials(name: string, email: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const src = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? email).slice(0, 2);
  return src.toUpperCase();
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function UserMenu({ me }: { me: Organizer }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const { count } = usePending();
  const isAdmin = me.role === "admin";
  const btn = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const signOut = async () => {
    setFailed(false);
    // Unsaved drafts (Points and Schedule editors) must not outlive the session on a shared computer: wipe them before the request.
    clearAllDrafts();
    clearCoverHandoff(); // a pending cover (encoded image files held in memory after a failed upload) must not outlive the session either
    if (await logout()) navigate("/panel/login", true);
    else setFailed(true);
  };

  return (
    <div className="umenu-wrap" ref={root}>
      <button
        ref={btn}
        type="button"
        className={`umenu${open ? " open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={isAdmin && count > 0 ? t("adMenuSr", { n: count }) : t("accountMenu")}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="av" aria-hidden="true">
          {initials(me.displayName, me.email)}
          {isAdmin && count > 0 && <span className="pa-dot">{count > 99 ? "99+" : count}</span>}
        </span>
        <span className="uname">{me.displayName}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...stroke}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="dd" role="menu">
          <div className="who">
            <b>{me.displayName}</b>
            <span className="muted small">{me.email}</span>
          </div>
          <Link to="/panel" role="menuitem" onClick={() => setOpen(false)}>{t("myEvents")}</Link>
          {isAdmin && (
            <>
              <Link to="/panel/admin/pending" role="menuitem" onClick={() => setOpen(false)}>
                {t("adTabPending")}
                {count > 0 && <span className="pa-cnt" aria-label={t("adWaitingSr", { n: count })}>{count}</span>}
              </Link>
              <Link to="/panel/admin/published" role="menuitem" onClick={() => setOpen(false)}>{t("adTabPublished")}</Link>
              <Link to="/panel/admin/requests" role="menuitem" onClick={() => setOpen(false)}>
                {t("reqNav")}
                <span className="mini">{t("adminBadge")}</span>
              </Link>
              <Link to="/panel/admin/invites" role="menuitem" onClick={() => setOpen(false)}>
                {t("invitesNav")}
                <span className="mini">{t("adminBadge")}</span>
              </Link>
            </>
          )}
          <hr />
          <button type="button" role="menuitem" className="dd-btn" onClick={signOut}>{t("signOut")}</button>
          {failed && <p className="dd-err small" role="alert">{t("signOutFailed")}</p>}
        </div>
      )}
    </div>
  );
}

function Frame({ me, children }: { me: Organizer; children: ReactNode }) {
  return (
    <div className="app pe" data-theme="auto">
      <header className="ptop">
        <Brand />
        <span className="sp" />
        <LangSwitch />
        <UserMenu me={me} />
      </header>
      <main className="pmain">{children}</main>
    </div>
  );
}

export function NoAccess() {
  const { t } = useI18n();
  return (
    <div className="status-card">
      <h1>{t("noAccessTitle")}</h1>
      <p>{t("noAccessText")}</p>
      <Link to="/panel" className="btn primary">{t("myEvents")}</Link>
    </div>
  );
}

/**
 * Every panel route goes through here: GET /auth/me first. 401 sends to /panel/login. The client role
 * check only decides what to render; the server enforces access on every admin call regardless.
 */
export default function PanelGuard({ admin, bare, children }: { admin?: boolean; bare?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<{ kind: "loading" | "error" } | { kind: "ok"; me: Organizer }>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: "loading" });
    fetchMe(ctrl.signal)
      .then((r) => {
        if (r.status === "unauthenticated") navigate("/panel/login", true);
        else {
          if (r.status === "ok") {
            setCount(r.pendingCount);
            purgeForeignDrafts(r.organizer.id); // another account's leftovers on this browser
          }
          setState(r.status === "ok" ? { kind: "ok", me: r.organizer } : { kind: "error" });
        }
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [attempt]);

  if (state.kind === "loading") {
    return (
      <div className="app" data-theme="auto">
        <p className="loading" role="status">{t("panelLoading")}</p>
      </div>
    );
  }
  if (state.kind !== "ok") {
    return (
      <div className="app" data-theme="auto">
        <div className="status-card">
          <h1>{t("unavailableTitle")}</h1>
          <p>{t("err_generic")}</p>
          <button type="button" className="btn primary" onClick={() => setAttempt((n) => n + 1)}>{t("retry")}</button>
        </div>
      </div>
    );
  }
  const ctx = { count, setCount };
  const meCtx = { organizerId: state.me.id };
  if (bare) return <MeContext value={meCtx}><PendingContext value={ctx}><div className="app pe" data-theme="auto">{admin && state.me.role !== "admin" ? <NoAccess /> : children}</div></PendingContext></MeContext>;
  return (
    <MeContext value={meCtx}>
      <PendingContext value={ctx}>
        <Frame me={state.me}>{admin && state.me.role !== "admin" ? <NoAccess /> : children}</Frame>
      </PendingContext>
    </MeContext>
  );
}
