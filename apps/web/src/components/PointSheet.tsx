import { useEffect, useRef } from "react";
import type { EventInfo, Point } from "@atlas/contract";
import { CategoryIcon } from "../markers/Pixel";
import { CATEGORY_INFO } from "../markers/categories";
import { useI18n } from "../i18n/I18nProvider";
import { displayName } from "../lib/pointLabel";
import SessionsPanel from "./SessionsPanel";
import type { TimedSession } from "../lib/schedule";

/** Bottom sheet on phones, side panel from 768px (see styles). All content is rendered as React text. */
export default function PointSheet({
  point,
  onClose,
  event,
  sessions = [],
  atMs = null,
  focus = null,
  onSeeOnMap,
}: {
  point: Point;
  onClose: () => void;
  event?: Pick<EventInfo, "slug" | "name" | "timeZone" | "dayStart">;
  /** Sessions of this Point (slice 09). Without any, the sheet is the plain description sheet. */
  sessions?: TimedSession[];
  /** Simulated "now" (`?at=`), render only. */
  atMs?: number | null;
  /** Slice 10: a Session tapped in the grid; the panel opens on its day with it outlined. */
  focus?: { sessionId: string; day: string; nonce: number } | null;
  /** Slice 10: shown only when the sheet was opened from the Schedule grid. */
  onSeeOnMap?: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);

  // Remember what had focus when the sheet opened, and give it back on close.
  useEffect(() => {
    opener.current = document.activeElement;
    return () => {
      const el = opener.current as HTMLElement | null;
      if (el && el.isConnected && el !== document.body) el.focus?.({ preventScroll: true });
    };
  }, []);

  // Move focus into the sheet whenever a (different) point is shown, so screen readers read it.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [point.id]);

  const info = CATEGORY_INFO[point.category];
  const chipVars = { "--chip-deep": info?.deep, "--chip-light": info?.light } as React.CSSProperties;

  return (
    <section
      ref={ref}
      className="sheet"
      role="dialog"
      aria-modal="false"
      aria-labelledby="sheet-title"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="sheet-grab" aria-hidden="true" />
      <div className="sheet-row">
        <span className="chip" style={chipVars}>
          <CategoryIcon category={point.category} size={28} />
          {/* Without a custom name the title already is the category label: do not say it twice. */}
          {point.name ? t(`cat_${point.category}` as any) : null}
        </span>
        <button type="button" className="icon-btn sheet-close" onClick={onClose} aria-label={t("closeSheet")}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <h2 id="sheet-title" className="sheet-title">{displayName(point, t)}</h2>
      {onSeeOnMap && (
        <button type="button" className="btn primary see-map" onClick={onSeeOnMap}>
          <svg className="ln" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
            <circle cx="12" cy="9.5" r="2.5" />
          </svg>
          {t("seeOnMap")}
        </button>
      )}
      {event && sessions.length > 0 ? (
        <>
          <SessionsPanel key={`${point.id}:${focus?.nonce ?? 0}`} point={point} event={event} sessions={sessions} atMs={atMs} focusId={focus?.sessionId} focusDay={focus?.day} />
          {point.description && (
            <p className="sheet-desc about">
              <b>{t("aboutPlace")}.</b> {point.description}
            </p>
          )}
        </>
      ) : (
        <p className="sheet-desc">{point.description || t("noDescription")}</p>
      )}
    </section>
  );
}
