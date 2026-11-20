import { lazy, Suspense } from "react";
import { I18nProvider } from "./i18n/I18nProvider";
import { matchEventSlug, usePath } from "./lib/router";
import EventPage from "./pages/EventPage";
import Home from "./pages/Home";
import { PageNotFound } from "./pages/Pages";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";

const PanelRoutes = lazy(() => import("./pages/panel/PanelRoutes"));
// Slice 30: the organizer page carries its own CSS, art and the Turnstile glue; visitors of the map never download it.
const Organizers = lazy(() => import("./pages/Organizers"));

export function Routes() {
  const path = usePath();
  if (path === "/panel" || path.startsWith("/panel/")) {
    return (
      <Suspense fallback={null}>
        <PanelRoutes />
      </Suspense>
    );
  }
  const slug = matchEventSlug(path);
  if (slug !== null) return <EventPage key={slug} slug={slug} />;
  if (path === "/" || path === "") return <Home />;
  if (path === "/organizadores" || path === "/organizadores/") {
    return (
      <Suspense fallback={null}>
        <Organizers />
      </Suspense>
    );
  }
  if (path === "/privacy" || path === "/privacy/") return <Privacy />;
  if (path === "/terms" || path === "/terms/") return <Terms />;
  return <PageNotFound />;
}

export default function App() {
  return (
    <I18nProvider>
      <Routes />
    </I18nProvider>
  );
}
