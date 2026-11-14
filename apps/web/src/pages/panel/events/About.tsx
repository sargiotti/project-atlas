import { useI18n } from "../../../i18n/I18nProvider";
import { countryName } from "../../../lib/events";
import { safeHttps } from "../../../lib/eventForm";
import { zoneOffset } from "../../../lib/timeZones";
import { Ic, dateRange } from "./common";

/**
 * The website is the only link in the whole panel: https at render time, nothing otherwise. Opens in a new
 * tab without leaking the referrer or the opener. The visible text is the host, as plain text.
 */
export function WebsiteLink({ url, className }: { url: string | null | undefined; className?: string }) {
  const u = safeHttps(url);
  if (!u) return null;
  return (
    <a className={className} href={u.href} target="_blank" rel="noopener noreferrer nofollow ugc" dir="auto">
      {u.host}
    </a>
  );
}

/**
 * "About the event": date and zone, place, description, website. Organizer text is only ever rendered as
 * React text; the description keeps its line breaks (white-space: pre-line) and URLs in it stay plain text.
 */
export function AboutRows({
  start,
  end,
  timeZone,
  city,
  country,
  description,
  website,
  language,
  linkWebsite,
}: {
  start: string;
  end: string;
  timeZone: string;
  city: string;
  country: string;
  description: string | null | undefined;
  website: string | null | undefined;
  language: string;
  /** false in the form's live preview: nothing there should be clickable. */
  linkWebsite: boolean;
}) {
  const { t, lang } = useI18n();
  const range = dateRange(start, end, lang);
  const site = safeHttps(website);
  const at = start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? new Date(`${start}T12:00:00Z`) : new Date();
  return (
    <>
      <div className="pe-arow">
        <Ic n="cal" size={18} />
        <div>
          {range || <span className="pe-sk" style={{ width: 130 }} />}
          {timeZone && <small>{t("peTzCaption", { o: zoneOffset(timeZone, at) })}</small>}
        </div>
      </div>
      <div className="pe-arow">
        <Ic n="pin" size={18} />
        <div dir="auto" lang={language}>
          {city.trim() ? city : <span className="pe-sk" style={{ width: 80 }} />}
          {country ? `, ${countryName(country, lang)}` : ""}
        </div>
      </div>
      {description && description.trim() && (
        <div className="pe-adesc" dir="auto" lang={language}>
          {description.trim()}
        </div>
      )}
      {site && (
        <div className="pe-arow">
          <Ic n="globe" size={18} />
          {linkWebsite ? <WebsiteLink url={site.href} className="pe-alink" /> : <span className="pe-alink" dir="auto">{site.host}</span>}
        </div>
      )}
    </>
  );
}
