import { slugSchema } from "@atlas/contract";
import { encode } from "uqr";

/** Slice 28 share kit. QR model shared by the badge (canvas), the SVG export and the flyer (React SVG). */

export const INK = "#1E2340";
export const PAPER = "#FFFFFF";
export const TANGERINE = "#FF6A3D";
export const CREAM = "#FAF6EF";
export const QUIET = 4; // modules of white around the code, in every variant

/** The only URL the kit ever encodes: the build-time public origin plus a validated slug. Never location.*. */
export function buildEventUrl(slug: string): string {
  return `${__PUBLIC_ORIGIN__}/e/${slugSchema.parse(slug)}`;
}

/** Filenames come from the validated slug only. */
export function kitFilename(slug: string, kind: "badge" | "qr"): string {
  return `leyenda-${slugSchema.parse(slug)}-${kind === "badge" ? "badge.png" : "qr.svg"}`;
}

export type Qr = {
  version: number;
  size: number;
  data: boolean[][];
  /** Odd side (in modules) of the white centre window that holds the pin; 0 when there is no pin. */
  knock: number;
};

/** Pixel-pin knockout: only up to QR version 6. From version 7 the centre holds an alignment pattern. */
export function knockoutSide(version: number, size: number): number {
  if (version > 6) return 0;
  let k = Math.floor(0.24 * size);
  if (k % 2 === 0) k += Math.abs(0.24 * size - (k + 1)) < Math.abs(0.24 * size - (k - 1)) ? 1 : -1;
  return k;
}

export function makeQr(text: string): Qr {
  // Error correction H, no library border (we add our own quiet zone).
  const r = encode(text, { ecc: "H", border: 0, boostEcc: false });
  return { version: r.version, size: r.size, data: r.data, knock: knockoutSide(r.version, r.size) };
}

function inKnock(qr: Qr, x: number, y: number) {
  if (!qr.knock) return false;
  const from = (qr.size - qr.knock) / 2;
  return x >= from && x < from + qr.knock && y >= from && y < from + qr.knock;
}

/** Horizontal runs of dark modules, in module units, skipping the knockout window. */
export function darkRuns(qr: Qr): { x: number; y: number; w: number }[] {
  const runs: { x: number; y: number; w: number }[] = [];
  for (let y = 0; y < qr.size; y++) {
    let x = 0;
    while (x < qr.size) {
      if (!qr.data[y][x] || inKnock(qr, x, y)) { x++; continue; }
      const start = x;
      while (x < qr.size && qr.data[y][x] && !inKnock(qr, x, y)) x++;
      runs.push({ x: start, y, w: x - start });
    }
  }
  return runs;
}

export const qrPathD = (qr: Qr) => darkRuns(qr).map((r) => `M${r.x} ${r.y}h${r.w}v1h-${r.w}z`).join("");

/** The pixel pin: 80x80 grid. Tangerine body, window in the colour of what sits behind it. */
export const PIN_BODY: [number, number, number, number][] = [
  [16, 0, 48, 8], [8, 8, 64, 8], [0, 16, 80, 8], [0, 24, 24, 16], [56, 24, 24, 16],
  [0, 40, 80, 8], [8, 48, 64, 8], [16, 56, 48, 8], [24, 64, 32, 8], [32, 72, 16, 8],
];
export const PIN_WINDOW: [number, number, number, number] = [24, 24, 32, 16];

/** Pin placement inside the code, in module units: k-2 modules wide, centred in the knockout. */
export function pinBox(qr: Qr) {
  const side = qr.knock - 2;
  return { x: (qr.size - side) / 2, y: (qr.size - side) / 2, side };
}

/**
 * Standalone SVG for print shops (1A): QR geometry only. No text, script, foreignObject, external href or fonts.
 * Every interpolated value is a number computed here.
 */
export function qrSvgMarkup(qr: Qr): string {
  const full = qr.size + QUIET * 2;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges">`;
  s += `<rect width="${full}" height="${full}" fill="${PAPER}"/>`;
  s += `<path transform="translate(${QUIET} ${QUIET})" d="${qrPathD(qr)}" fill="${INK}"/>`;
  if (qr.knock) {
    const p = pinBox(qr);
    s += `<g transform="translate(${QUIET + p.x} ${QUIET + p.y}) scale(${p.side / 80})">`;
    s += `<g fill="${TANGERINE}">${PIN_BODY.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`).join("")}</g>`;
    const [wx, wy, ww, wh] = PIN_WINDOW;
    s += `<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" fill="${INK}"/></g>`;
  }
  return `${s}</svg>`;
}

/** Subset of CanvasRenderingContext2D the QR drawing needs (lets tests rasterise it without a browser). */
export type Ctx = Pick<CanvasRenderingContext2D, "fillRect" | "save" | "restore" | "translate" | "scale"> & { fillStyle: any };

/** Draws the code with its quiet zone into a square of `px` pixels at (x, y). */
export function drawQr(ctx: Ctx, qr: Qr, x: number, y: number, px: number) {
  const full = qr.size + QUIET * 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(px / full, px / full);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, full, full);
  ctx.fillStyle = INK;
  for (const r of darkRuns(qr)) ctx.fillRect(QUIET + r.x, QUIET + r.y, r.w, 1);
  if (qr.knock) {
    const p = pinBox(qr);
    ctx.translate(QUIET + p.x, QUIET + p.y);
    ctx.scale(p.side / 80, p.side / 80);
    ctx.fillStyle = TANGERINE;
    for (const [px_, py_, w, h] of PIN_BODY) ctx.fillRect(px_, py_, w, h);
    ctx.fillStyle = INK;
    ctx.fillRect(...PIN_WINDOW);
  }
  ctx.restore();
}
