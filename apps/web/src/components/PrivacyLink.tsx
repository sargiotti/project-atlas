import { useI18n } from "../i18n/I18nProvider";
import { Link } from "../lib/router";

/** Site footer: the only thing in it is the link to the privacy notice (slice 12). */
export function SiteFooter() {
  const { t } = useI18n();
  return (
    <footer className="site-footer">
      <Link to="/privacy">{t("privacyLink")}</Link>
      <Link to="/terms">{t("termsLink")}</Link>
    </footer>
  );
}

/** Small corner link for the full-screen event page, which has no scrolling page to put a footer in. */
export function EventPrivacyLink() {
  const { t } = useI18n();
  return (
    <Link to="/privacy" className="event-privacy">
      {t("privacyLink")}
    </Link>
  );
}
