import { useEffect, useState } from "react";
import type { PanelEvent } from "@atlas/contract";
import { getEvent } from "../../../api/panelEvents";
import { getPoints, type ServerPoint } from "../../../api/panelPoints";
import { useI18n } from "../../../i18n/I18nProvider";
import { clearDraft } from "../../../lib/pointsDraft";
import { Link, navigate } from "../../../lib/router";
import { Brand } from "../parts";
import { useMe } from "../pending";
import EditorView from "./points/EditorView";
import { Ic, LoadError, Loading, PanelNotFound, useDocTitle } from "./common";

/** Below this width only a notice is shown (the editor needs a mouse and room). Touch drag still works from here up. */
export const EDITOR_MIN_WIDTH = 1024;

export function useViewportWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

/** /panel/events/:id/points: the organizer's Points editor. Desktop only. */
export default function PointsEditor({ id }: { id: string }) {
  const width = useViewportWidth();
  return width >= EDITOR_MIN_WIDTH ? <Loader id={id} /> : <SmallScreen id={id} />;
}

/** The "open this on a computer" notice. The Schedule editor (slice 13) reuses it with its own copy. */
export function SmallScreen({ id, keys = { title: "pedTitle", head: "pedSmallT", text: "pedSmallS" } }: { id: string; keys?: { title: string; head: string; text: string } }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useDocTitle(`${t(keys.title as any)} · ${t("appName")}`);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the link is in the address bar anyway */
    }
  };
  return (
    <div className="ped-small">
      <div className="ped-small-head"><Brand /></div>
      <div className="status-card" role="region" aria-labelledby="ped-small-t">
        <Ic n="map" size={40} />
        <h1 id="ped-small-t">{t(keys.head as any)}</h1>
        <p>{t(keys.text as any)}</p>
        <div className="pe-acts">
          <button type="button" className="btn primary" onClick={() => void copy()}>{copied ? <><Ic n="check" size={18} />{t("pedLinkCopied")}</> : t("pedCopyLink")}</button>
          <Link to={`/panel/events/${id}`} className="btn">{t("pedBack")}</Link>
        </div>
      </div>
    </div>
  );
}

type State =
  | { k: "loading" | "error" | "missing" | "nomap" }
  | { k: "ok"; event: PanelEvent; points: ServerPoint[]; updatedAt: string; sessionCounts: Record<string, number> };

function Loader({ id }: { id: string }) {
  const { t } = useI18n();
  const { organizerId } = useMe();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ k: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ k: "loading" });
    Promise.all([getEvent(id, ctrl.signal), getPoints(id, ctrl.signal)])
      .then(([e, p]) => {
        if (e.status === "unauthenticated" || p.status === "unauthenticated") return void navigate("/panel/login", true, true);
        if (e.status === "not_found" || p.status === "not_found") {
          if (organizerId) clearDraft(organizerId, id); // the event is gone: so is its draft
          return void setState({ k: "missing" });
        }
        if (e.status === "error" || p.status === "error") return void setState({ k: "error" });
        if (p.status !== "ok" || !e.event.map) return void setState({ k: "nomap" });
        setState({ k: "ok", event: e.event, points: p.points, updatedAt: p.eventUpdatedAt, sessionCounts: p.sessionCounts });
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [id, attempt]);

  useDocTitle(state.k === "ok" ? `${t("pedTitle")} · ${state.event.name}` : t("appName"));

  if (state.k === "loading") return <Loading />;
  if (state.k === "error") return <LoadError onRetry={() => setAttempt((n) => n + 1)} />;
  if (state.k === "missing" || !organizerId) return <PanelNotFound />;
  if (state.k === "nomap") {
    return (
      <div className="ped-small">
        <div className="ped-small-head"><Brand /></div>
        <div className="status-card">
          <Ic n="map" size={40} />
          <h1>{t("pedNoMapT")}</h1>
          <p>{t("pedNoMapS")}</p>
          <Link to={`/panel/events/${id}`} className="btn primary">{t("pedBack")}</Link>
        </div>
      </div>
    );
  }
  if (state.k !== "ok") return null;
  return <EditorView event={state.event} initial={{ points: state.points, updatedAt: state.updatedAt, sessionCounts: state.sessionCounts }} organizerId={organizerId} />;
}
