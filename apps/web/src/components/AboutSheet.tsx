import { useEffect, useRef } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { AboutRows } from "../pages/panel/events/About";
import { Ic } from "../pages/panel/events/common";

type AboutEvent = {
  slug: string;
  name: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  language: string;
  city?: string;
  country?: string;
  venueAddress?: string;
  description?: string;
  website?: string;
};

/**
 * Visitor "About the event" sheet. Loaded on demand (lazy) from the event page; it never opens by itself.
 * Same rows as the owner preview. Escape or the close button closes it and gives focus back to the (i) button.
 */
export default function AboutSheet({ event, onClose }: { event: AboutEvent; onClose: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    ref.current?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <section ref={ref} tabIndex={-1} className="pe-about vis" role="dialog" aria-label={t("pePvAbout")}>
      <div className="pe-ahead">
        <span className="pe-eyebrow">{t("pePvAbout")}</span>
        <button type="button" className="icon-btn" aria-label={t("close")} onClick={onClose}>
          <Ic n="x" />
        </button>
      </div>
      <h2 dir="auto" lang={event.language}>{event.name}</h2>
      <AboutRows
        start={event.startDate}
        end={event.endDate}
        timeZone={event.timeZone}
        city={event.city}
        country={event.country}
        venueAddress={event.venueAddress}
        description={event.description}
        website={event.website}
        language={event.language}
        linkWebsite
        share={{ slug: event.slug, name: event.name }}
      />
    </section>
  );
}
