import { useMemo } from "react";
import { CategoryIcon } from "../../../../markers/Pixel";
import { useI18n } from "../../../../i18n/I18nProvider";
import { byDisplayName, displayName, pointSearchText } from "../../../../lib/pointLabel";
import { POINT_CATEGORIES, needsName, type EditorPoint } from "../../../../lib/pointsModel";
import { queryWords } from "../../../../lib/search";
import { Ic } from "../common";

type Props = {
  points: EditorPoint[];
  selKey: string | null;
  query: string;
  onQuery: (q: string) => void;
  onSelect: (key: string) => void;
  onHover: (key: string | null) => void;
};

/** "Placed (N)" tab: every Point grouped by category, searchable by the localized label and the custom name. */
export default function PlacedList({ points, selKey, query, onQuery, onSelect, onHover }: Props) {
  const { t, lang } = useI18n();
  const words = useMemo(() => queryWords(query), [query]);

  const groups = useMemo(() => {
    const sorter = byDisplayName<EditorPoint>(t as any, lang);
    return POINT_CATEGORIES.map((c) => ({
      category: c,
      items: points
        .filter((p) => p.category === c && words.every((w) => pointSearchText(p, t as any).includes(w)))
        .sort(sorter),
    })).filter((g) => g.items.length > 0);
  }, [points, words, t, lang]);

  return (
    <>
      <div className="ped-srch">
        <Ic n="search" size={18} />
        <input type="search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder={t("pedSearch")} aria-label={t("pedSearch")} autoComplete="off" />
      </div>
      {points.length === 0 ? (
        <p className="ped-noresult">{t("pedNoneYet")}</p>
      ) : groups.length === 0 ? (
        <p className="ped-noresult" role="status">{t("pedNoResults")}</p>
      ) : (
        groups.map((g) => (
          <section key={g.category} className="ped-lgrp" aria-label={t(`cat_${g.category}` as any)}>
            <h3><CategoryIcon category={g.category} size={18} />{t(`cat_${g.category}` as any)} <span className="n">{g.items.length}</span></h3>
            <ul>
              {g.items.map((p) => {
                const missing = needsName(p);
                return (
                  <li key={p.key}>
                    <button
                      type="button"
                      className={`ped-lrow${p.key === selKey ? " on" : ""}`}
                      aria-pressed={p.key === selKey}
                      onClick={() => onSelect(p.key)}
                      onMouseEnter={() => onHover(p.key)}
                      onMouseLeave={() => onHover(null)}
                      onFocus={() => onHover(p.key)}
                      onBlur={() => onHover(null)}
                    >
                      <span className={`nm${missing ? " un" : ""}`} dir="auto">{missing ? t("pedNeedsName") : displayName(p, t as any)}</span>
                      {p.description && <span className="ds" dir="auto">{p.description}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
