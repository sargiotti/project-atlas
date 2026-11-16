import { afterEach, describe, expect, it, vi } from "vitest";

// jsdom has no canvas: a fake 2D context and a toBlob that behaves like Safari (no WebP) or Chrome.
function stubCanvas(opts: { webp: boolean; jpegSize: (q: number) => number }) {
  const types: string[] = [];
  const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as any);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, cb, type = "image/png", q = 0.92) {
    types.push(type);
    const small = this.width <= 800;
    if (type === "image/webp" && !opts.webp) return cb(new Blob([new Uint8Array(10)], { type: "image/png" })); // Safari: PNG instead
    const size = type === "image/jpeg" ? opts.jpegSize(q) / (small ? 4 : 1) : 1000;
    const head = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 4, 0, 0, 0, 0]);
    const body = new Uint8Array(Math.max(size, head.length));
    body.set(head);
    cb(new Blob([body], { type }));
  });
  return types;
}

const bitmap = { width: 2400, height: 1600, close() {} } as any;

describe("encodeCover without WebP (Safari)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("falls back to JPEG for full and small, stepping quality down until each fits its cap", async () => {
    vi.resetModules();
    const { FULL_MAX_BYTES, SMALL_MAX_BYTES } = await import("../src/lib/coverRules");
    // Over the caps at high quality, under them once quality drops.
    stubCanvas({ webp: false, jpegSize: (q) => (q > 0.7 ? 900 * 1024 : 250 * 1024) });
    const { encodeCover } = await import("../src/lib/coverImage");
    const r = await encodeCover(bitmap, { x: 0.5, y: 0.5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.full.type).toBe("image/jpeg");
    expect(r.value.small.type).toBe("image/jpeg");
    expect(r.value.og.type).toBe("image/jpeg");
    expect(r.value.full.size).toBeLessThanOrEqual(FULL_MAX_BYTES);
    expect(r.value.small.size).toBeLessThanOrEqual(SMALL_MAX_BYTES);
  });

  it("keeps WebP where the browser can encode it", async () => {
    vi.resetModules();
    stubCanvas({ webp: true, jpegSize: () => 1000 });
    const { encodeCover } = await import("../src/lib/coverImage");
    const r = await encodeCover(bitmap, { x: 0.5, y: 0.5 });
    expect(r.ok && r.value.full.type).toBe("image/webp");
    expect(r.ok && r.value.small.type).toBe("image/webp");
  });
});
