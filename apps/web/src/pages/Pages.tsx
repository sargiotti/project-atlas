import { useEffect, type ReactNode } from "react";
import LangSwitch from "../components/LangSwitch";
import { LogoMark } from "../markers/Pixel";
import { Link } from "../lib/router";
import { SiteFooter } from "../components/PrivacyLink";
import { useI18n } from "../i18n/I18nProvider";

/** Page frame for pages that are not the map: brand header + language selector. */
export function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={`app${wide ? " wide" : ""}`} data-theme="auto">
      <header className="shell-header">
        <Link to="/" className="brand">
          <LogoMark size={32} />
          <span className="wordmark">{t("appName")}</span>
        </Link>
        <LangSwitch />
      </header>
      <main className="shell-main">{children}</main>
      <SiteFooter />
    </div>
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

/** Any event that is not public (never existed, in review, rejected, unpublished, deleted): one identical page. */
export function EventGone() {
  const { t } = useI18n();
  useEffect(() => {
    const prev = document.title;
    document.title = `${t("eventGoneDocTitle")} · ${t("appName")}`;
    return () => {
      document.title = prev;
    };
  }, [t]);
  return (
    <Shell>
      <StatusMessage
        title={t("eventGoneTitle")}
        text={t("eventGoneText")}
        action={<Link to="/" className="btn primary">{t("eventGoneCta")}</Link>}
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
