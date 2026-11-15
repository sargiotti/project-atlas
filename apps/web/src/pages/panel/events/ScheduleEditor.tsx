import { useEffect, useState } from "react";
import type { PanelEvent, PanelSessionsResponse } from "@atlas/contract";
import { getEvent } from "../../../api/panelEvents";
import { getSessions } from "../../../api/panelSessions";
import { useI18n } from "../../../i18n/I18nProvider";
import { navigate } from "../../../lib/router";
import { clearScheduleDraft } from "../../../lib/scheduleDraft";
import { useMe } from "../pending";
import { LoadError, Loading, PanelNotFound, useDocTitle } from "./common";
import { EDITOR_MIN_WIDTH, SmallScreen, useViewportWidth } from "./PointsEditor";
import EditorView from "./schedule/EditorView";

/** /panel/events/:id/schedule[?place=<pointId>]: the organizer's Schedule editor (slice 13). Desktop only. */
export default function ScheduleEditor({ id }: { id: string }) {
  const width = useViewportWidth();
  return width >= EDITOR_MIN_WIDTH ? <Loader id={id} /> : <SmallScreen id={id} keys={{ title: "sedTitle", head: "sedSmallT", text: "sedSmallS" }} />;
}

type State = { k: "loading" | "error" | "missing" } | { k: "ok"; event: PanelEvent; data: PanelSessionsResponse };

function Loader({ id }: { id: string }) {
  const { t } = useI18n();
  const { organizerId } = useMe();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ k: "loading" });
  // The deep link from the Points editor Inspector. Only used as a hint: an unknown id is ignored.
  const [placeParam] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("place");
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ k: "loading" });
    Promise.all([getEvent(id, ctrl.signal), getSessions(id, ctrl.signal)])
      .then(([e, s]) => {
        if (e.status === "unauthenticated" || s.status === "unauthenticated") return void navigate("/panel/login", true, true);
        if (e.status === "not_found" || s.status === "not_found") {
          if (organizerId) clearScheduleDraft(organizerId, id); // the event is gone: so is its draft
          return void setState({ k: "missing" });
        }
        if (e.status === "error" || s.status === "error") return void setState({ k: "error" });
        setState({ k: "ok", event: e.event, data: s as PanelSessionsResponse });
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [id, attempt]);

  useDocTitle(state.k === "ok" ? `${t("sedTitle")} · ${state.event.name}` : t("appName"));

  if (state.k === "loading") return <Loading />;
  if (state.k === "error") return <LoadError onRetry={() => setAttempt((n) => n + 1)} />;
  if (state.k === "missing" || !organizerId) return <PanelNotFound />;
  if (state.k !== "ok") return null;
  return <EditorView event={state.event} initial={state.data} organizerId={organizerId} placeParam={placeParam} />;
}
