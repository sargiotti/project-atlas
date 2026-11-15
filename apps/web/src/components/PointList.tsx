import type { Point } from "@atlas/contract";
import { POINT_CATEGORIES } from "../markers/categories";
import { CATEGORY_INFO } from "../markers/categories";
import { CategoryIcon } from "../markers/Pixel";
import { useCount, useI18n } from "../i18n/I18nProvider";
import { byDisplayName, displayName } from "../lib/pointLabel";

/** Accessible alternative to the map: points grouped by category, in POINT_CATEGORIES order. */
export default function PointList({ points, onPick }: { points: Point[]; onPick: (id: string) => void }) {
  const { t, lang } = useI18n();
  const count = useCount();
  const groups = POINT_CATEGORIES.map((c) => ({ category: c, items: points.filter((p) => p.category === c).sort(byDisplayName(t, lang)) })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <div className="point-list" aria-label={t("listLabel")}>
      {groups.map((g) => {
        const info = CATEGORY_INFO[g.category];
        const headingId = `cat-${g.category}`;
        return (
          <section key={g.category} aria-labelledby={headingId} className="list-group">
            <h2 id={headingId} className="list-heading">
              <span className="chip" style={{ "--chip-deep": info.deep, "--chip-light": info.light } as React.CSSProperties}>
                <CategoryIcon category={g.category} size={24} />
                {t(`cat_${g.category}` as any)}
              </span>
              <span className="count">{count(g.items.length)}</span>
            </h2>
            <ul>
              {g.items.map((p) => (
                <li key={p.id}>
                  <button type="button" className="list-item" onClick={() => onPick(p.id)} data-point-id={p.id}>
                    <span className="list-text">
                      <span className="list-name">{displayName(p, t)}</span>
                      {p.description && <span className="list-desc">{p.description}</span>}
                    </span>
                    <span className="list-go">
                      <span className="sr-only">{t("showOnMap")}</span>
                      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
