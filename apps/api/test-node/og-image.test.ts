import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { OG_HARD_CAP_BYTES, inspectOgJpeg } from "../scripts/jpeg-safety";
import { loadBadge, loadBrandCard, renderEventOg } from "../scripts/og-image";

const root = resolve(import.meta.dirname, "../../..");
const badge = loadBadge(resolve(root, "design/assets/og/badge.png"));
const cover = (slug: string) => readFileSync(resolve(root, `design/assets/event-covers/${slug}.webp`));
const OG_KEY = /^[a-z0-9]+(-[a-z0-9]+)*\.[0-9a-f]{8}\.jpg$/;

describe("OG image build step (T4)", () => {
  it.each(["fiestas-la-alameda", "havnelobet", "mercado-medieval-toledo", "nightfall-meadows"])("renders %s as a 1200x630 baseline JPEG under the cap, no metadata", async (slug) => {
    const og = await renderEventOg(slug, cover(slug), badge);
    expect(og.key).toMatch(OG_KEY);
    expect(og.key.startsWith(`${slug}.`)).toBe(true);
    expect(og.bytes.length).toBeLessThanOrEqual(OG_HARD_CAP_BYTES);
    // Segment-level check: only DQT/DHT/SOF0/DRI/APP0 before the scan, so no EXIF, XMP, GPS, ICC or COM.
    expect(inspectOgJpeg(og.bytes)).toMatchObject({ width: 1200, height: 630 });

    const meta = await sharp(og.bytes).metadata();
    expect(meta).toMatchObject({ format: "jpeg", width: 1200, height: 630, space: "srgb", isProgressive: false, chromaSubsampling: "4:2:0" });
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(og.bytes.includes(Buffer.from("Exif"))).toBe(false);
    expect(og.bytes.includes(Buffer.from("http://ns.adobe.com"))).toBe(false);
  });

  it("is deterministic: same cover gives the same hashed name", async () => {
    const a = await renderEventOg("havnelobet", cover("havnelobet"), badge);
    const b = await renderEventOg("havnelobet", cover("havnelobet"), badge);
    expect(a.key).toBe(b.key);
  });

  it("rejects a cover smaller than 960x504", async () => {
    const small = await sharp({ create: { width: 800, height: 500, channels: 3, background: "#808080" } }).webp().toBuffer();
    await expect(renderEventOg("tiny", small, badge)).rejects.toThrow(/smaller than 960x504/);
  });

  it("accepts the hand-made brand card and names it by content hash", () => {
    const card = loadBrandCard(resolve(root, "design/assets/og/brand-card.jpg"));
    expect(card.key).toMatch(/^brand-card\.[0-9a-f]{8}\.jpg$/);
    expect(inspectOgJpeg(card.bytes)).toMatchObject({ width: 1200, height: 630 });
  });

  it("refuses JPEGs that carry metadata or are not baseline 1200x630", async () => {
    const base = sharp({ create: { width: 1200, height: 630, channels: 3, background: "#336699" } });
    const withExif = await base.clone().withExif({ IFD0: { Copyright: "x" } }).jpeg().toBuffer();
    expect(() => inspectOgJpeg(withExif)).toThrow(/disallowed JPEG segment/);
    const progressive = await base.clone().jpeg({ progressive: true }).toBuffer();
    expect(() => inspectOgJpeg(progressive)).toThrow(/disallowed JPEG segment/);
    const wrong = await sharp({ create: { width: 600, height: 315, channels: 3, background: "#336699" } }).jpeg().toBuffer();
    expect(() => inspectOgJpeg(wrong)).toThrow(/expected 1200x630/);
  });
});
