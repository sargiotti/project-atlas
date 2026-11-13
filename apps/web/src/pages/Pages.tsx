import type { ReactNode } from "react";
import LangSwitch from "../components/LangSwitch";
import { LogoMark } from "../markers/Pixel";
import { Link } from "../lib/router";
import { useI18n } from "../i18n/I18nProvider";

// Names are event content, shown as-is. This list only exists for the demo landing page.
const DEMO_EVENTS = [
  { slug: "nightfall-meadows", name: "Nightfall Meadows Festival 2026", lang: "en" },
  { slug: "fiestas-la-alameda", name: "Fiestas del Barrio de la Alameda 2026", lang: "es" },
  { slug: "havnelobet", name: "Havneløbet 2026", lang: "da" },
];

/** Page frame for pages that are not the map: brand header + language selector. */
export function Shell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="app" data-theme="auto">
      <header className="shell-header">
        <Link to="/" className="brand">
          <LogoMark size={32} />
          <span className="wordmark">{t("appName")}</span>
        </Link>
        <LangSwitch />
      </header>
      <main className="shell-main">{children}</main>
    </div>
  );
}

export function Landing() {
  const { t } = useI18n();
  return (
    <Shell>
      <h1 className="hero-title">{t("tagline")}</h1>
      <p className="lead">{t("landingIntro")}</p>
      <h2 className="section-title">{t("demoEvents")}</h2>
      <ul className="demo-list">
        {DEMO_EVENTS.map((e) => (
          <li key={e.slug}>
            <Link to={`/e/${e.slug}`} className="demo-link" lang={e.lang}>
              <span>{e.name}</span>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
            </Link>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

export function StatusMessage({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="status-card">
      <h1>{title}</h1>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function EventNotFound() {
  const { t } = useI18n();
  return (
    <Shell>
      <StatusMessage
        title={t("notFoundTitle")}
        text={t("notFoundText")}
        action={<Link to="/" className="btn primary">{t("goHome")}</Link>}
      />
    </Shell>
  );
}

export function PageNotFound() {
  const { t } = useI18n();
  return (
    <Shell>
      <StatusMessage
        title={t("pageNotFoundTitle")}
        text={t("pageNotFoundText")}
        action={<Link to="/" className="btn primary">{t("goHome")}</Link>}
      />
    </Shell>
  );
}

export function Unavailable({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <Shell>
      <StatusMessage
        title={t("unavailableTitle")}
        text={t("unavailableText")}
        action={<button type="button" className="btn primary" onClick={onRetry}>{t("retry")}</button>}
      />
    </Shell>
  );
}

export function Loading() {
  const { t } = useI18n();
  return (
    <Shell>
      <p className="loading" role="status">{t("loading")}</p>
    </Shell>
  );
}
