/**
 * Event tone (slice 14). Every event has one of 8 light tones, derived from its id, so a colour cover exists without any
 * stored field. Pure: no DOM, no React, no I/O. Used by the API (public `tone`), by the web (colour cover on the Home
 * cards, the About sheet and the panel) and by the build script of the 8 static link-preview images.
 */

export const TONE_COUNT = 8;
export type Tone = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** The only palette (light tones, also in the dark theme). The earlier dark variants (`--pfd`) are gone. */
export const TONE_FILLS = ["#FBE7A6", "#D7DCFA", "#CDEDC4", "#FBD3B0", "#FAD3E7", "#C6EEF2", "#FBD0CF", "#EEEBC0"] as const;

/** The exact hash the panel always used (`h = h * 31 + charCode >>> 0`, then `% 8`), so existing events keep their colour. */
export function toneOf(id: string): Tone {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % TONE_COUNT) as Tone;
}

// --- Colour cover geometry ---------------------------------------------------------------------
// viewBox 600x300: tone fill, a faint map grid (2x2 dots every 30), two pixel trails (8-unit squares every 18 along two
// curves) towards the centre, four small pixel "x" marks, a white tile 100x100 (radius 26, 6-unit offset shadow) and the
// Atlas pin (16x16 pixel art, scale 4). `shape-rendering: crispEdges` on the pixel layers.

/** Atlas pin pixel art: [fill, path data] layers on a 16x16 grid. */
export const FALLBACK_LOGO: ReadonlyArray<readonly [string, string]> = [
  ["#3A2C78", "M5 0h6v1h-6zM3 1h2v1h-2zM11 1h2v1h-2zM2 2h1v1h-1zM13 2h1v1h-1zM1 3h1v1h-1zM14 3h1v1h-1zM1 4h1v1h-1zM14 4h1v1h-1zM0 5h1v1h-1zM15 5h1v1h-1zM0 6h1v1h-1zM15 6h1v1h-1zM1 7h1v1h-1zM14 7h1v1h-1zM1 8h1v1h-1zM14 8h1v1h-1zM2 9h1v1h-1zM13 9h1v1h-1zM3 10h1v1h-1zM12 10h1v1h-1zM4 11h1v1h-1zM11 11h1v1h-1zM5 12h1v1h-1zM10 12h1v1h-1zM6 13h1v1h-1zM9 13h1v1h-1zM7 14h2v1h-2z"],
  ["#5B45B0", "M10 1h1v1h-1zM12 2h1v1h-1zM13 3h1v1h-1zM13 4h1v1h-1zM14 5h1v1h-1zM1 6h1v1h-1zM14 6h1v1h-1zM13 7h1v1h-1zM2 8h1v1h-1zM13 8h1v1h-1zM3 9h1v1h-1zM12 9h1v1h-1zM4 10h1v1h-1zM11 10h1v1h-1zM5 11h1v1h-1zM10 11h1v1h-1zM6 12h1v1h-1zM9 12h1v1h-1zM7 13h2v1h-2z"],
  ["#7F68D8", "M5 2h6v1h-6zM3 3h10v1h-10zM3 4h4v1h-4zM9 4h4v1h-4zM2 5h4v1h-4zM10 5h4v1h-4zM2 6h4v1h-4zM10 6h4v1h-4zM3 7h4v1h-4zM9 7h4v1h-4zM3 8h10v1h-10zM4 9h8v1h-8zM5 10h6v1h-6zM6 11h4v1h-4zM7 12h2v1h-2z"],
  ["#B9A8F0", "M5 1h5v1h-5zM3 2h2v1h-2zM11 2h1v1h-1zM2 3h1v1h-1zM2 4h1v1h-1zM1 5h1v1h-1zM2 7h1v1h-1z"],
  ["#B5DB7A", "M7 4h2v1h-2zM6 5h4v1h-4zM6 6h4v1h-4zM7 7h2v1h-2z"],
];

function curvePoints(p0: [number, number], p1: [number, number], p2: [number, number], step: number): Array<[number, number]> {
  const N = 200;
  const all: Array<[number, number]> = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    all.push([
      (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
      (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1],
    ]);
  }
  const pts: Array<[number, number]> = [];
  let acc = step;
  for (let i = 1; i < all.length; i++) {
    acc += Math.hypot(all[i]![0] - all[i - 1]![0], all[i]![1] - all[i - 1]![1]);
    if (acc >= step) {
      pts.push(all[i]!);
      acc = 0;
    }
  }
  return pts;
}

const TRAIL_POINTS = [...curvePoints([-20, 262], [150, 250], [236, 170], 18), ...curvePoints([620, 40], [440, 40], [366, 130], 18)];

const xMark = (cx: number, cy: number) =>
  `M${cx - 6} ${cy - 6}h4v4h-4zM${cx + 2} ${cy - 6}h4v4h-4zM${cx - 2} ${cy - 2}h4v4h-4zM${cx - 6} ${cy + 2}h4v4h-4zM${cx + 2} ${cy + 2}h4v4h-4z`;

const GRID_PATH = (() => {
  let g = "";
  for (let x = 15; x < 600; x += 30) for (let y = 15; y < 300; y += 30) g += `M${x} ${y}h2v2h-2z`;
  return g;
})();
const TRAIL_PATH = TRAIL_POINTS.map(([x, y]) => `M${(x - 4).toFixed(1)} ${(y - 4).toFixed(1)}h8v8h-8z`).join("");
const MARKS_PATH = xMark(96, 74) + xMark(508, 238) + xMark(176, 226) + xMark(452, 70);

/** Every fixed value of the colour cover, as data, so a UI can build its own elements without any string-to-HTML step. */
export interface FallbackCoverGeometry {
  viewBox: "0 0 600 300";
  background: string;
  grain: { fill: string; d: string };
  trail: { fill: string; d: string };
  marks: { fill: string; d: string };
  shadow: { fill: string; x: number; y: number; width: number; height: number; rx: number };
  tile: { fill: string; x: number; y: number; width: number; height: number; rx: number };
  /** Atlas pin: translate, scale and the pixel-art layers. */
  pin: { transform: string; layers: ReadonlyArray<{ fill: string; d: string }> };
}

export function fallbackCoverGeometry(tone: number): FallbackCoverGeometry {
  const t = Number.isInteger(tone) && tone >= 0 && tone < TONE_COUNT ? tone : 0;
  return {
    viewBox: "0 0 600 300",
    background: TONE_FILLS[t]!,
    grain: { fill: "rgba(31,27,51,.07)", d: GRID_PATH },
    trail: { fill: "rgba(31,27,51,.2)", d: TRAIL_PATH },
    marks: { fill: "rgba(31,27,51,.2)", d: MARKS_PATH },
    shadow: { fill: "rgba(20,16,40,.13)", x: 250, y: 106, width: 100, height: 100, rx: 26 },
    tile: { fill: "#fff", x: 250, y: 100, width: 100, height: 100, rx: 26 },
    pin: { transform: "translate(268 118) scale(4)", layers: FALLBACK_LOGO.map(([fill, d]) => ({ fill, d })) },
  };
}

export interface FallbackCoverOptions {
  /** Pixel size of the root element. Omitted: the SVG fills its container (`width/height: 100%`). */
  size?: { width: number; height: number };
}

/** The colour cover as an SVG document string. Pure string builder over fixed values (only the tone index varies, and it is clamped). */
export function fallbackCoverSvg(tone: number, opts: FallbackCoverOptions = {}): string {
  const g = fallbackCoverGeometry(tone);
  const dims = opts.size ? `width="${opts.size.width}" height="${opts.size.height}"` : `style="display:block;width:100%;height:100%"`;
  const layers = g.pin.layers.map((l) => `<path fill="${l.fill}" d="${l.d}"/>`).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${g.viewBox}" preserveAspectRatio="xMidYMid slice" ${dims} aria-hidden="true" focusable="false">` +
    `<rect width="600" height="300" fill="${g.background}"/>` +
    `<path fill="${g.grain.fill}" d="${g.grain.d}"/>` +
    `<path fill="${g.trail.fill}" d="${g.trail.d}" shape-rendering="crispEdges"/>` +
    `<path fill="${g.marks.fill}" d="${g.marks.d}" shape-rendering="crispEdges"/>` +
    `<rect x="${g.shadow.x}" y="${g.shadow.y}" width="${g.shadow.width}" height="${g.shadow.height}" rx="${g.shadow.rx}" fill="${g.shadow.fill}"/>` +
    `<rect x="${g.tile.x}" y="${g.tile.y}" width="${g.tile.width}" height="${g.tile.height}" rx="${g.tile.rx}" fill="${g.tile.fill}"/>` +
    `<g transform="${g.pin.transform}" shape-rendering="crispEdges">${layers}</g>` +
    `</svg>`
  );
}
