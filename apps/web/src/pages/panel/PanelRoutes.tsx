import { matchInviteToken, usePath } from "../../lib/router";
import { PageNotFound } from "../Pages";
import AdminInvites from "./AdminInvites";
import InvitePage from "./InvitePage";
import PanelGuard from "./PanelGuard";
import PanelHome from "./PanelHome";
import PanelLogin from "./PanelLogin";

/** Everything under /panel. Loaded lazily so visitors never download it. */
export default function PanelRoutes() {
  const path = usePath().replace(/\/+$/, "");
  const token = matchInviteToken(path);
  if (token !== null) return <InvitePage key={token} token={token} />;
  if (path === "/panel/login") return <PanelLogin />;
  if (path === "/panel") {
    return (
      <PanelGuard>
        <PanelHome />
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
