import type { ReactNode } from "react";
import { ICONS, QUEST_ARROW, TOKENS, TOKENS_SELECTED, type Layer } from "./pixelArt";
import { CATEGORY_INFO } from "./categories";

export type MapTheme = "light" | "dark";

const layers = (ls: Layer[]): ReactNode => ls.map(([fill, d], i) => <path key={i} fill={fill} d={d} />);

/** 16x16 pixel icon of a Point Category, rendered at `size` CSS px. */
export function CategoryIcon({ category, size = 32 }: { category: string; size?: number }) {
  const art = ICONS[category];
  if (!art) return null;
  return (
    <svg className="px" width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {layers(art)}
    </svg>
  );
}

/**
 * Marker token (round = thing to do, square = service; shapes come from the art).
 * Drawn at 2 CSS px per art pixel. The anchor (centre of the token) is at (w/2, w/2) art px.
 */
export function MarkerToken({ category, theme, selected }: { category: string; theme: MapTheme; selected?: boolean }) {
  const t = (selected ? TOKENS_SELECTED : TOKENS)[theme][category];
  if (!t) return null;
  return (
    <svg className="px" width={t.w * 2} height={t.h * 2} viewBox={`0 0 ${t.w} ${t.h}`} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {layers(t.paths)}
      <svg x={t.ix} y={t.iy} width="16" height="16" viewBox="0 0 16 16">
        {layers(ICONS[category])}
      </svg>
    </svg>
  );
}

/** The small bobbing quest arrow above the selected marker (animation lives in CSS). */
export function QuestArrow({ theme }: { theme: MapTheme }) {
  const a = QUEST_ARROW[theme];
  return (
    <svg className="px quest-arrow" width={a.w * 2} height={a.h * 2} viewBox={`0 0 ${a.w} ${a.h}`} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {layers(a.paths)}
    </svg>
  );
}

// Brand mark (handoff 2.1): a 10x10 pixel pin, tangerine with an "inner window" that follows the text colour
// (ink on light backgrounds, paper on dark ones). `mono` paints the whole pin in the text colour.
const MARK_ROWS = ["..XXXXXX..", ".XXXXXXXX.", "XXXXXXXXXX", "XXXOOOOXXX", "XXXOOOOXXX", "XXXXXXXXXX", ".XXXXXXXX.", "..XXXXXX..", "...XXXX...", "....XX...."];
export function LogoMark({ size = 28, mono = false }: { size?: number; mono?: boolean }) {
  return (
    <svg className="px" width={size} height={size} viewBox="0 0 80 80" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {MARK_ROWS.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === "." ? null : <rect key={`${x}-${y}`} x={x * 8} y={y * 8} width="8" height="8" fill={c === "O" ? "var(--ink)" : mono ? "var(--ink)" : "#FF6A3D"} />,
        ),
      )}
    </svg>
  );
}

export const TOKEN_SIZE = { default: { w: 40, h: 44, anchor: 20 }, selected: { w: 44, h: 48, anchor: 22 } };
export { CATEGORY_INFO };
