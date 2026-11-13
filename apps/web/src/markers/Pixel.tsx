import type { ReactNode } from "react";
import { ICONS, LOGO_MARK, QUEST_ARROW, TOKENS, TOKENS_SELECTED, type Layer } from "./pixelArt";
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

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="px" width={size} height={size} viewBox={`0 0 ${LOGO_MARK.w} ${LOGO_MARK.h}`} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {layers(LOGO_MARK.paths)}
    </svg>
  );
}

export const TOKEN_SIZE = { default: { w: 40, h: 44, anchor: 20 }, selected: { w: 44, h: 48, anchor: 22 } };
export { CATEGORY_INFO };
