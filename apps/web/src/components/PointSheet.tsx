import { useEffect, useRef } from "react";
import type { Point } from "@atlas/contract";
import { CategoryIcon } from "../markers/Pixel";
import { CATEGORY_INFO } from "../markers/categories";
import { useI18n } from "../i18n/I18nProvider";

/** Bottom sheet on phones, side panel from 768px (see styles). All content is rendered as React text. */
export default function PointSheet({ point, onClose }: { point: Point; onClose: () => void }) {
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
          {t(`cat_${point.category}` as any)}
        </span>
        <button type="button" className="icon-btn sheet-close" onClick={onClose} aria-label={t("closeSheet")}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <h2 id="sheet-title" className="sheet-title">{point.name}</h2>
      <p className="sheet-desc">{point.description || t("noDescription")}</p>
    </section>
  );
}
