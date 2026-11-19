import { useI18n } from "../i18n/I18nProvider";
import { Link } from "../lib/router";

/** Site footer: the only thing in it is the link to the privacy notice (slice 12). */
export function SiteFooter() {
  const { t } = useI18n();
  return (
    <footer className="site-footer">
      <Link to="/privacy">{t("privacyLink")}</Link>
    </footer>
  );
}

/**
 * Thin strip below the public event map (slice 30): the privacy link and a discreet invitation to create a map. The second link is a fixed
 * internal path, never built from event data. The strip takes its own row, so it never covers the map.
 */
export function EventFootStrip() {
  const { t } = useI18n();
  return (
    <footer className="event-foot">
      <Link to="/privacy">{t("privacyLink")}</Link>
      <Link to="/organizadores" className="foot-org">{t("orgMapFoot")}</Link>
    </footer>
  );
}
