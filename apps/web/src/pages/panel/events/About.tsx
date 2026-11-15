import { useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import { countryName } from "../../../lib/events";
import { safeHttps } from "../../../lib/eventForm";
import { mapsSearchUrl } from "../../../lib/maps";
import { zoneOffset } from "../../../lib/timeZones";
import { buildShareUrl } from "../../../components/ShareDialog";
import { Ic, dateRange } from "./common";

/**
 * The website is the only link in the whole panel: https at render time, nothing otherwise. Opens in a new
 * tab without leaking the referrer or the opener. The visible text is the ASCII (punycode) host from
 * URL.hostname, never decoded, never the path or userinfo, as plain text.
 */
export function WebsiteLink({ url, className }: { url: string | null | undefined; className?: string }) {
  const u = safeHttps(url);
  if (!u) return null;
  return (
    <a className={className} href={u.href} target="_blank" rel="noopener noreferrer nofollow ugc" dir="ltr">
      {u.hostname.replace(/^www\./, "")}
    </a>
  );
}

/**
 * "Share" for the About sheet: the native sheet from the tap handler, else copy the link, else select the
 * visible URL. The URL is built from the origin and the slug, never from location.href; only the event name
 * goes along as the title.
 */
export function ShareButton({ slug, name }: { slug: string; name: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const input = useRef<HTMLInputElement>(null);
  const onClick = async () => {
    const url = buildShareUrl(slug);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: name, url });
        return;
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        // Any other failure: fall back to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
      window.setTimeout(() => setState((s) => (s === "copied" ? "idle" : s)), 2500);
    } catch {
      setState("manual");
      window.setTimeout(() => input.current?.select(), 0);
    }
  };
  return (
    <div className="pe-ashare">
      <button type="button" className="btn" onClick={onClick}>
        <Ic n="share" size={18} />
        <span>{t("share")}</span>
      </button>
      <span className="sr-only" role="status">{state === "copied" ? t("abLinkCopied") : ""}</span>
      {state === "copied" && <span className="pe-acopied" aria-hidden="true"><Ic n="check" size={16} />{t("abLinkCopied")}</span>}
      {state === "manual" && (
        <input
          ref={input}
          className="pe-inp pe-ashare-url"
          type="text"
          readOnly
          dir="ltr"
          aria-label={t("shareLink")}
          value={buildShareUrl(slug)}
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
    </div>
  );
}

/**
 * "About the event": date and zone, place, description, website, share. Organizer text is only ever rendered
 * as React text; the description keeps its line breaks (white-space: pre-line) and URLs in it stay plain text.
 * Rows without data are hidden (the form's live preview shows skeletons instead).
 */
export function AboutRows({
  start,
  end,
  timeZone,
  city,
  country,
  venueAddress,
  description,
  website,
  language,
  linkWebsite,
  share,
}: {
  start: string;
  end: string;
  timeZone: string;
  city?: string | null;
  country?: string | null;
  venueAddress?: string | null;
  description: string | null | undefined;
  website: string | null | undefined;
  language: string;
  /** false in the form's live preview: nothing there should be clickable, and unfilled fields show skeletons. */
  linkWebsite: boolean;
  /** Set when the event can be shared (published): shows the Share button. */
  share?: { slug: string; name: string } | null;
}) {
  const { t, lang } = useI18n();
  const live = linkWebsite;
  const range = dateRange(start, end, lang);
  const site = safeHttps(website);
  const at = start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? new Date(`${start}T12:00:00Z`) : new Date();
  const cityText = (city ?? "").trim();
  const countryText = country ? countryName(country, lang) : "";
  const address = (venueAddress ?? "").trim();
  const place = [cityText, countryText].filter(Boolean).join(", ");
  const mapsUrl = live ? mapsSearchUrl(address, cityText, countryText) : null;
  return (
    <>
      <div className="pe-arow">
        <Ic n="cal" size={18} />
        <div>
          {range || <span className="pe-sk" style={{ width: 130 }} />}
          {timeZone && <small>{t("peTzCaption", { o: zoneOffset(timeZone, at) })}</small>}
        </div>
      </div>
      {(place || address || !live) && (
        <div className="pe-arow">
          <Ic n="pin" size={18} />
          <div dir="auto" lang={language}>
            {address && <b className="pe-aaddr">{address}</b>}
            {place ? (address ? <small>{place}</small> : place) : !live ? <span className="pe-sk" style={{ width: 80 }} /> : null}
            {mapsUrl && (
              <a className="btn sm pe-amaps" href={mapsUrl} target="_blank" rel="noopener noreferrer" dir="auto" lang={lang}>
                {t("abOpenMaps")}
              </a>
            )}
          </div>
        </div>
      )}
      {description && description.trim() && (
        <div className="pe-adesc" dir="auto" lang={language}>
          {description.trim()}
        </div>
      )}
      {site && (
        <div className="pe-arow">
          <Ic n="globe" size={18} />
          {linkWebsite ? <WebsiteLink url={site.href} className="pe-alink" /> : <span className="pe-alink" dir="ltr">{site.hostname.replace(/^www\./, "")}</span>}
        </div>
      )}
      {share && <ShareButton slug={share.slug} name={share.name} />}
    </>
  );
}
