import { useMemo } from "react";
import { I18nProvider } from "../../i18n/I18nProvider";
import { initialPanelLang } from "../../i18n/detect";
import { matchAdminReview, matchInviteToken, matchPanelEvent, usePath } from "../../lib/router";
import { PageNotFound } from "../Pages";
import AdminInvites from "./AdminInvites";
import AdminList from "./admin/AdminLists";
import AdminReview from "./admin/AdminReview";
import InvitePage from "./InvitePage";
import PanelGuard from "./PanelGuard";
import PanelLogin from "./PanelLogin";
import EventForm from "./events/EventForm";
import EventHub from "./events/EventHub";
import EventPreview from "./events/EventPreview";
import PointsEditor from "./events/PointsEditor";
import ScheduleEditor from "./events/ScheduleEditor";
import EventsList from "./events/EventsList";

/**
 * Everything under /panel. Loaded lazily so visitors never download it. The panel has its own default
 * language: the browser's if it is en, es or da, otherwise English (the visitor default stays Spanish).
 */
export default function PanelRoutes() {
  const initial = useMemo(initialPanelLang, []);
  return (
    <I18nProvider initial={initial}>
      <Screens />
    </I18nProvider>
  );
}

function Screens() {
  const path = usePath().replace(/\/+$/, "");
  const token = matchInviteToken(path);
  if (token !== null) return <InvitePage key={token} token={token} />;
  if (path === "/panel/login") return <PanelLogin />;
  if (path === "/panel") {
    return (
      <PanelGuard>
        <EventsList />
      </PanelGuard>
    );
  }
  if (path === "/panel/events/new") {
    return (
      <PanelGuard>
        <EventForm key="new" />
      </PanelGuard>
    );
  }
  const ev = matchPanelEvent(path);
  if (ev?.view === "hub") {
    return (
      <PanelGuard>
        <EventHub key={ev.id} id={ev.id} />
      </PanelGuard>
    );
  }
  if (ev?.view === "edit") {
    return (
      <PanelGuard>
        <EventForm key={ev.id} id={ev.id} />
      </PanelGuard>
    );
  }
  if (ev?.view === "points") {
    return (
      <PanelGuard bare>
        <PointsEditor key={ev.id} id={ev.id} />
      </PanelGuard>
    );
  }
  if (ev?.view === "schedule") {
    return (
      <PanelGuard bare>
        <ScheduleEditor key={ev.id} id={ev.id} />
      </PanelGuard>
    );
  }
  if (ev?.view === "preview") {
    return (
      <PanelGuard bare>
        <EventPreview key={ev.id} id={ev.id} />
      </PanelGuard>
    );
  }
  if (path === "/panel/admin/pending" || path === "/panel/admin/published") {
    return (
      <PanelGuard admin>
        <AdminList key={path} kind={path.endsWith("pending") ? "pending" : "published"} />
      </PanelGuard>
    );
  }
  const reviewId = matchAdminReview(path);
  if (reviewId) {
    return (
      <PanelGuard admin bare>
        <AdminReview key={reviewId} id={reviewId} />
      </PanelGuard>
    );
  }
  if (path === "/panel/admin/invites") {
    return (
      <PanelGuard admin>
        <AdminInvites />
      </PanelGuard>
    );
  }
  return <PageNotFound />;
}
