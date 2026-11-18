import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import jsQR from "jsqr";
import { I18nProvider } from "../src/i18n/I18nProvider";
import ShareKit from "../src/pages/panel/events/ShareKit";
import QrSvg from "../src/components/QrSvg";
import { buildEventUrl, drawQr, kitFilename, makeQr, qrSvgMarkup, type Ctx } from "../src/lib/shareKit/qr";
import { fitName } from "../src/lib/shareKit/badge";

const SLUG = "fiestas-la-alameda";
const LONG_SLUG = "a".repeat(30) + "-" + "b".repeat(29); // 60 chars: QR version 7 or higher
const EV: any = {
  id: "5b1c2d3e-0000-4000-8000-000000000001",
  slug: SLUG,
  status: "published",
  name: "Fiestas de La Alameda",
  startDate: "2026-12-04",
  endDate: "2026-12-07",
  city: "Valencia",
  language: "es",
};

function mount(event: any = EV, lang: "es" | "en" = "en") {
  return render(
    <I18nProvider initial={lang}>
      <ShareKit event={event} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  // jsdom has no canvas; the badge preview just skips drawing.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as any);
});
afterEach(() => vi.restoreAllMocks());

/** Rasterises an SVG string and decodes the QR in it, like a phone scanner would. */
async function decodeSvg(svg: string) {
  const sized = svg.replace("<svg ", '<svg width="900" height="900" ');
  const { data, info } = await sharp(Buffer.from(sized)).flatten({ background: "#fff" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data;
}

/** Minimal 2D context that only supports what drawQr uses, rasterising into RGBA pixels. */
function rasterCtx(size: number) {
  const buf = new Uint8ClampedArray(size * size * 4).fill(255);
  let m = { x: 0, y: 0, s: 1 };
  const stack: (typeof m)[] = [];
  const ctx: any = {
    fillStyle: "#000000",
    save: () => stack.push({ ...m }),
    restore: () => void (m = stack.pop()!),
    translate: (x: number, y: number) => { m = { ...m, x: m.x + x * m.s, y: m.y + y * m.s }; },
    scale: (a: number) => { m = { ...m, s: m.s * a }; },
    fillRect(x: number, y: number, w: number, h: number) {
      const hex = String(ctx.fillStyle).replace("#", "");
      const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const x0 = Math.round(m.x + x * m.s), x1 = Math.round(m.x + (x + w) * m.s);
      const y0 = Math.round(m.y + y * m.s), y1 = Math.round(m.y + (y + h) * m.s);
      for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) buf.set([...rgb, 255], (py * size + px) * 4);
    },
  };
  return { buf, ctx: ctx as Ctx };
}

describe("share kit: what gets encoded", () => {
  it("encodes exactly the public origin + /e/ + slug", () => {
    expect(buildEventUrl(SLUG)).toBe(`${__PUBLIC_ORIGIN__}/e/${SLUG}`);
    expect(() => buildEventUrl("Bad Slug?x=1")).toThrow();
    expect(() => buildEventUrl("../admin")).toThrow();
    expect(kitFilename(SLUG, "badge")).toBe(`leyenda-${SLUG}-badge.png`);
    expect(kitFilename(SLUG, "qr")).toBe(`leyenda-${SLUG}-qr.svg`);
  });

  it("the SVG export, the flyer QR and the badge canvas drawing all decode to the exact URL", async () => {
    const url = buildEventUrl(SLUG);
    const qr = makeQr(url);
    expect(qr.version).toBeLessThanOrEqual(6);
    expect(qr.knock).toBeGreaterThan(0); // pin present on short codes
    expect(await decodeSvg(qrSvgMarkup(qr))).toBe(url);
    expect(await decodeSvg(renderToStaticMarkup(<QrSvg qr={qr} label="x" />))).toBe(url);

    // Canvas path (same function the 1080x1350 badge uses), rendered into a pixel buffer.
    const px = 720;
    const { buf, ctx } = rasterCtx(px);
    drawQr(ctx, qr, 0, 0, px);
    expect(jsQR(buf, px, px)?.data).toBe(url);
  });

  it("a 60-char slug has no centre pin and still decodes", async () => {
    const url = buildEventUrl(LONG_SLUG);
    const qr = makeQr(url);
    expect(qr.version).toBeGreaterThanOrEqual(7);
    expect(qr.knock).toBe(0);
    const svg = qrSvgMarkup(qr);
    expect(svg).not.toContain("#FF6A3D");
    expect(await decodeSvg(svg)).toBe(url);
    const { buf, ctx } = rasterCtx(900);
    drawQr(ctx, qr, 0, 0, 900);
    expect(jsQR(buf, 900, 900)?.data).toBe(url);
  });

  it("the SVG export holds QR geometry only", () => {
    const svg = qrSvgMarkup(makeQr(buildEventUrl(SLUG)));
    expect(svg).not.toMatch(/<text|<script|foreignObject|href=|font|<image|<style|<title/i);
    expect(svg.match(/<(\w+)/g)!.every((t) => ["<svg", "<rect", "<path", "<g"].includes(t))).toBe(true);
  });

  it("a very long event name is cut to 2 lines at a fixed width", () => {
    const ctx: any = { font: "", measureText: (s: string) => ({ width: s.length * 30 }) };
    const r = fitName(ctx, "Festival ".repeat(30), 940);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[1].endsWith("…")).toBe(true);
    expect(r.size).toBe(64);
    expect(fitName(ctx, "x".repeat(200), 940).lines.every((l) => l.length * 30 <= 940)).toBe(true);
  });
});

describe("share kit card", () => {
  it.each(["draft", "in_review", "review", "rejected", "unpublished"])("is not shown for a %s event", (status) => {
    mount({ ...EV, status });
    expect(screen.queryByText("Share your map")).not.toBeInTheDocument();
  });

  it("is shown for a published event with the link", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Share your map" })).toBeInTheDocument();
    expect(screen.getByLabelText("Your map link")).toHaveValue(`${__PUBLIC_ORIGIN__}/e/${SLUG}`);
  });

  it("copy puts the link on the clipboard and confirms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mount();
    await userEvent.click(screen.getByRole("button", { name: /copy link/i }));
    expect(writeText).toHaveBeenCalledWith(`${__PUBLIC_ORIGIN__}/e/${SLUG}`);
    expect(await screen.findByRole("button", { name: /link copied/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/copied/i);
  });

  it("when the clipboard is refused it selects the readonly link and says so", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
    mount();
    await userEvent.click(screen.getByRole("button", { name: /copy link/i }));
    const input = screen.getByLabelText("Your map link") as HTMLInputElement;
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/ctrl\+c/i));
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("readonly");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("the language selector defaults to the panel language and changes the flyer text", async () => {
    mount(EV, "en");
    const select = screen.getByLabelText("QR and flyer language") as HTMLSelectElement;
    expect(select.value).toBe("en");
    await userEvent.click(screen.getByRole("button", { name: /print a4 flyer/i }));
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveTextContent("Scan to see the map and the schedule");
    expect(dlg).toHaveTextContent(/December 4/);
    expect(document.title).toBe(`${SLUG}-cartel`);
    expect(dlg).toHaveTextContent(`${__PUBLIC_ORIGIN__.replace("https://", "")}/e/${SLUG}`);

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await userEvent.selectOptions(select, "ca");
    await userEvent.click(screen.getByRole("button", { name: /imprimeix|print a4/i }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(/Escaneja per veure el mapa i els horaris.*desembre|desembre.*Escaneja/s);
  });
});
