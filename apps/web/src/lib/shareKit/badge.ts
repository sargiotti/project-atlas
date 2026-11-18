import { CREAM, INK, PAPER, PIN_BODY, PIN_WINDOW, QUIET, TANGERINE, drawQr, type Qr } from "./qr";
import { KIT_TEXT, kitMeta, type KitLang } from "./copy";

export const BADGE_W = 1080;
export const BADGE_H = 1350;
const DISPLAY = '"Bricolage Grotesque", sans-serif';
const BODY = "Figtree, sans-serif";

/** Bundled, same-origin fonts only (see main.tsx). Waits until the faces needed for this text are ready. */
export async function loadKitFonts(text: string) {
  const fonts = (typeof document !== "undefined" && (document as any).fonts) as FontFaceSet | undefined;
  if (!fonts?.load) return;
  try {
    await Promise.all([fonts.load(`800 100px ${DISPLAY}`, text), fonts.load(`700 40px ${BODY}`, text)]);
    await fonts.ready;
  } catch {
    // Fall back to the system fonts rather than blocking the download.
  }
}

type Text2D = Pick<CanvasRenderingContext2D, "measureText" | "font">;

/** Largest of `sizes` at which `name` fits in at most 2 lines of `maxW`; at the smallest size the second line is ellipsized. */
export function fitName(ctx: Text2D, name: string, maxW: number, sizes = [100, 92, 84, 76, 70, 64]): { size: number; lines: string[] } {
  const clean = name.replace(/\s+/g, " ").trim();
  for (const size of sizes) {
    ctx.font = `800 ${size}px ${DISPLAY}`;
    const lines = wrap(ctx, clean, maxW);
    if (lines.length <= 2) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  ctx.font = `800 ${size}px ${DISPLAY}`;
  const lines = wrap(ctx, clean, maxW);
  return { size, lines: [lines[0], ellipsize(ctx, lines.slice(1).join(" "), maxW)] };
}

function wrap(ctx: Text2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(" ")) {
    const next = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(next).width <= maxW) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    cur = word;
    // A single word wider than the line is cut at the character level.
    while (ctx.measureText(cur).width > maxW && cur.length > 1) {
      let n = cur.length - 1;
      while (n > 1 && ctx.measureText(cur.slice(0, n)).width > maxW) n--;
      lines.push(cur.slice(0, n));
      cur = cur.slice(n);
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function ellipsize(ctx: Text2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, side: number, window: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(side / 80, side / 80);
  ctx.fillStyle = TANGERINE;
  for (const r of PIN_BODY) ctx.fillRect(...r);
  ctx.fillStyle = window;
  ctx.fillRect(...PIN_WINDOW);
  ctx.restore();
}

export type BadgeInput = { name: string; startDate: string; endDate: string; city: string; qr: Qr; lang: KitLang };

/** Option 1B: ink card, 1080x1350. All organizer text goes through fillText with a fixed max width. */
export function drawBadge(canvas: HTMLCanvasElement, b: BadgeInput): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  canvas.width = BADGE_W;
  canvas.height = BADGE_H;
  const spacing = (px: number) => {
    try {
      (ctx as any).letterSpacing = `${px}px`;
    } catch {
      // Older engines ignore letter-spacing on canvas.
    }
  };
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, BADGE_W, BADGE_H);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // Name: up to 2 lines, 100 -> 64 px, then ellipsis. Fixed max width.
  const maxW = 940;
  spacing(0);
  const { size, lines } = fitName(ctx, b.name, maxW);
  ctx.font = `800 ${size}px ${DISPLAY}`;
  spacing(-0.03 * size);
  ctx.fillStyle = CREAM;
  const lh = size * 1.02;
  const first = lines.length === 1 ? 190 + lh / 2 : 190;
  lines.forEach((l, i) => ctx.fillText(l, BADGE_W / 2, first + i * lh, maxW));

  // Dates and city (short dates).
  spacing(0);
  ctx.font = `700 40px ${BODY}`;
  ctx.fillStyle = TANGERINE;
  const meta = ellipsize(ctx, kitMeta(b, b.lang, "short"), maxW);
  ctx.fillText(meta, BADGE_W / 2, first + (lines.length - 1) * lh + 66, maxW);

  // QR on a 700 px white rounded plate. Modules are a whole number of pixels, so edges stay crisp for scanners.
  const qx = 190, qy = 410, q = 700;
  const full = b.qr.size + QUIET * 2;
  const px = full * Math.floor(q / full);
  const off = Math.round((q - px) / 2);
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  if ((ctx as any).roundRect) (ctx as any).roundRect(qx, qy, q, q, 44);
  else ctx.rect(qx, qy, q, q);
  ctx.fill();
  drawQr(ctx, b.qr, qx + off, qy + off, px);

  // CTA.
  ctx.font = `700 50px ${BODY}`;
  ctx.fillStyle = CREAM;
  ctx.fillText(KIT_TEXT[b.lang].badgeCta, BADGE_W / 2, 1196, maxW);

  // Wordmark "leyenda<pin>ink", centred.
  const fs = 46;
  ctx.font = `800 ${fs}px ${DISPLAY}`;
  spacing(-0.03 * fs);
  ctx.textAlign = "left";
  const w1 = ctx.measureText("leyenda").width;
  const w2 = ctx.measureText("ink").width;
  const pin = fs * 0.76;
  const gapL = fs * 0.04;
  const gapR = fs * 0.02;
  const x0 = (BADGE_W - (w1 + gapL + pin + gapR + w2)) / 2;
  const base = 1290;
  ctx.fillText("leyenda", x0, base);
  drawPin(ctx, x0 + w1 + gapL, base - pin, pin, CREAM);
  ctx.fillText("ink", x0 + w1 + gapL + pin + gapR, base);
  spacing(0);
  return true;
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));
}
