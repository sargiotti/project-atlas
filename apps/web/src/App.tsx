import { lazy, Suspense } from "react";
import { I18nProvider } from "./i18n/I18nProvider";
import { matchEventSlug, usePath } from "./lib/router";
import EventPage from "./pages/EventPage";
import Home from "./pages/Home";
import { PageNotFound } from "./pages/Pages";

const PanelRoutes = lazy(() => import("./pages/panel/PanelRoutes"));

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
  return <PageNotFound />;
}

export default function App() {
  return (
    <I18nProvider>
      <Routes />
    </I18nProvider>
  );
}
