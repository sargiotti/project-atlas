import { I18nProvider } from "./i18n/I18nProvider";
import { matchEventSlug, usePath } from "./lib/router";
import EventPage from "./pages/EventPage";
import Home from "./pages/Home";
import { PageNotFound } from "./pages/Pages";

export function Routes() {
  const path = usePath();
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
