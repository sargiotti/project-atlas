import type { ReactNode } from "react";
import { QUEST_ARROW, type Layer } from "./pixelArt";
import { CATEGORY_INFO, PINS, type PinSpec } from "./categories";

export type MapTheme = "light" | "dark";

const layers = (ls: Layer[]): ReactNode => ls.map(([fill, d], i) => <path key={i} fill={fill} d={d} />);

// Glyph pixels as one rect per "on" cell (cell size c, origin ox/oy). Constants in, SVG out.
const glyphRects = (pin: PinSpec, c: number, ox: number, oy: number): ReactNode[] =>
  pin.glyph.flatMap((row, y) => [...row].map((ch, x) => (ch === "X" ? <rect key={`${x}-${y}`} x={ox + x * c} y={oy + y * c} width={c} height={c} /> : null)));

/** Round/square badge (24 viewBox) of a Point Category: body colour, thin ring, 8x8 glyph. Used in lists, chips, sheets and the editor. */
export function CategoryIcon({ category, size = 32 }: { category: string; size?: number }) {
  const pin = PINS[category];
  if (!pin) return null;
  const p = pin.light;
  return (
    <svg className="px" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {pin.head === "round" ? (
        <circle cx="12" cy="12" r="11.25" fill={p.body} stroke={p.ring} strokeWidth="1.5" />
      ) : (
        <rect x="0.75" y="0.75" width="22.5" height="22.5" rx="7" fill={p.body} stroke={p.ring} strokeWidth="1.5" />
      )}
      <g fill={p.glyph} shapeRendering="crispEdges">{glyphRects(pin, 1.5, 6, 6)}</g>
    </svg>
  );
}

export const SELECTED_SCALE = 1.1; // 10% bump when selected
// Tip (bottom point) of the pin in CSS px at scale 1 (tail ends at viewBox 22,50; origin is -2,-2). The map point sits on the tip.
export const PIN_ANCHOR = { x: 24, y: 52 };

/**
 * Map pin (handoff 3.2): ring layer under the body, slim point, 8x8 glyph. Round head = thing to do, square = service.
 * `scale` 1 = 48x56 CSS px (viewBox -2 -2 48 56).
 */
export function MarkerToken({ category, theme, selected, scale = 1 }: { category: string; theme: MapTheme; selected?: boolean; scale?: number }) {
  const pin = PINS[category];
  if (!pin) return null;
  const p = pin[theme];
  const s = scale * (selected ? SELECTED_SCALE : 1);
  const tail = "M15 38 L22 50 L29 38 Z";
  const head = pin.head === "round" ? <circle cx="22" cy="21" r="20" /> : <rect x="2" y="1" width="40" height="40" rx="12" />;
  return (
    <svg className="px" width={48 * s} height={56 * s} viewBox="-2 -2 48 56" aria-hidden="true" focusable="false">
      <g fill={p.ring} stroke={p.ring} strokeWidth="3" strokeLinejoin="round">
        <path d={tail} />
        {head}
      </g>
      <g fill={p.body}>
        <path d={tail} />
        {head}
      </g>
      <g fill={p.glyph} shapeRendering="crispEdges">{glyphRects(pin, 3, 10, 9)}</g>
    </svg>
  );
}

// ---- slice 23: cluster marker ---------------------------------------------------------------
// 3x5 pixel digits for the count.
const DIGITS: Record<string, string[]> = {
  "0": ["XXX", "X.X", "X.X", "X.X", "XXX"], "1": [".X.", "XX.", ".X.", ".X.", "XXX"], "2": ["XXX", "..X", "XXX", "X..", "XXX"],
  "3": ["XXX", "..X", ".XX", "..X", "XXX"], "4": ["X.X", "X.X", "XXX", "..X", "..X"], "5": ["XXX", "X..", "XXX", "..X", "XXX"],
  "6": ["XXX", "X..", "XXX", "X.X", "XXX"], "7": ["XXX", "..X", ".X.", ".X.", ".X."], "8": ["XXX", "X.X", "XXX", "X.X", "XXX"],
  "9": ["XXX", "X.X", "XXX", "..X", "XXX"],
};
function countRects(n: number, cx: number, cy: number): ReactNode[] {
  const s = String(Math.min(n, 999));
  const c = s.length > 2 ? 3 : 4; // cell size: three digits need smaller cells to fit the head
  const w = s.length * 3 * c + (s.length - 1) * c;
  const x0 = cx - w / 2;
  return [...s].flatMap((d, i) =>
    DIGITS[d]!.flatMap((row, y) => [...row].map((ch, x) => (ch === "X" ? <rect key={`${i}-${x}-${y}`} x={x0 + i * 4 * c + x * c} y={cy - 2.5 * c + y * c} width={c} height={c} /> : null))),
  );
}

/**
 * Cluster marker (slice 23): a pin whose front head shows the count, with up to two heads stacked behind in the 2nd and 3rd
 * member's category colour. 64x66 CSS px, tip at (28,60). Ink head on a light map, paper head on a dark one, white ring.
 * Colours come from the --cluster-* tokens, so the theme needs no props.
 */
export function ClusterToken({ count, colors }: { count: number; colors: string[] }) {
  const tail = "M15 38 L22 50 L29 38 Z";
  const ghost = (cx: number, cy: number, fill: string, key: string) => <circle key={key} cx={cx} cy={cy} r="17" fill={fill} stroke="#FFFFFF" strokeWidth="3" />;
  return (
    <svg className="px" width="64" height="66" viewBox="-6 -10 64 66" aria-hidden="true" focusable="false" overflow="visible">
      {colors[1] && ghost(39, 11, colors[1], "g3")}
      {colors[0] && ghost(31, 17, colors[0], "g2")}
      <g className="cluster-ring" strokeWidth="3" strokeLinejoin="round">
        <path d={tail} />
        <circle cx="22" cy="24" r="17" />
      </g>
      <g className="cluster-body">
        <path d={tail} />
        <circle cx="22" cy="24" r="17" />
      </g>
      <g className="cluster-ink" shapeRendering="crispEdges">{countRects(count, 22, 24)}</g>
    </svg>
  );
}

/** The close "x" at the centre of an open cluster (48x48). */
export function ClusterCloseToken() {
  return (
    <svg className="px" width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <circle className="cluster-ring" cx="24" cy="24" r="19" strokeWidth="3" />
      <circle className="cluster-body" cx="24" cy="24" r="19" />
      <g className="cluster-ink" shapeRendering="crispEdges">
        {[[15, 15], [18, 18], [21, 21], [24, 24], [27, 27], [30, 30], [30, 15], [27, 18], [18, 27], [15, 30]].map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="3" height="3" />)}
        <rect x="21" y="21" width="6" height="6" />
      </g>
    </svg>
  );
}

/** Body colour of a category's pin on the given map theme (used for the stacked heads of a cluster). */
export const pinBody = (category: string, theme: MapTheme): string => PINS[category]?.[theme].body ?? "#1E2340";

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

export { CATEGORY_INFO };
