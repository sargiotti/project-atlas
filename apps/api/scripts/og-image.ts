/**
 * Link-preview images (slice 04). Build-time only (sharp, Node): never imported by the Worker.
 * Spec: design deliverable 05, section 7. Event images are generated from the validated cover; the
 * brand card is the hand-made static file, validated and content-hashed but not re-encoded.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { OG_BUDGET_BYTES, OG_HEIGHT, OG_WIDTH, inspectOgJpeg } from "./jpeg-safety.ts";

export const BADGE = { left: 299, top: 546, width: 168, height: 72 } as const;
const QUALITIES = [85, 80, 75] as const;

export interface OgImage {
  bytes: Buffer;
  /** `{name}.{hash8}.jpg` */
  key: string;
  quality: number;
}

const hash8 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex").slice(0, 8);

/** Cover (any decodable raster, at least 960x504) to the 1200x630 preview with the Atlas badge. */
export async function renderEventOg(slug: string, cover: Uint8Array, badgePng: Uint8Array): Promise<OgImage> {
  const meta = await sharp(cover).metadata();
  const { width: w, height: h } = meta;
  if (!w || !h || w < 960 || h < 504) throw new Error(`${slug}: cover ${w}x${h} is smaller than 960x504`);

  const scale = Math.max(OG_WIDTH / w, OG_HEIGHT / h);
  const rw = Math.round(w * scale);
  const rh = Math.round(h * scale);
  const badge = await sharp(badgePng).metadata();
  if (badge.width !== BADGE.width || badge.height !== BADGE.height) {
    throw new Error(`badge must be ${BADGE.width}x${BADGE.height}, got ${badge.width}x${badge.height}`);
  }

  // Pass 1: resize (lanczos3) and centre-crop, flattened on white. Pass 2: badge, unscaled.
  const base = await sharp(cover)
    .resize(rw, rh, { kernel: "lanczos3", fit: "fill" })
    .extract({
      left: Math.round((rw - OG_WIDTH) / 2),
      top: Math.round((rh - OG_HEIGHT) / 2),
      width: OG_WIDTH,
      height: OG_HEIGHT,
    })
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .png()
    .toBuffer();

  for (const quality of QUALITIES) {
    // No withMetadata(): sharp strips all metadata by default.
    const bytes = await sharp(base)
      .composite([{ input: Buffer.from(badgePng), left: BADGE.left, top: BADGE.top }])
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .jpeg({
        quality,
        progressive: false,
        chromaSubsampling: "4:2:0",
        optimiseCoding: true,
        trellisQuantisation: true,
        overshootDeringing: true,
        quantisationTable: 3,
      })
      .toBuffer();
    if (bytes.length <= OG_BUDGET_BYTES) {
      inspectOgJpeg(bytes); // dims, baseline, no metadata segments
      return { bytes, key: `${slug}.${hash8(bytes)}.jpg`, quality };
    }
  }
  throw new Error(`${slug}: OG image is over ${OG_BUDGET_BYTES} bytes even at q${QUALITIES.at(-1)}`);
}

/** The hand-made brand card: validated (1200x630 baseline JPEG, no metadata, size) then copied as is. */
export function loadBrandCard(path: string): OgImage {
  const bytes = readFileSync(path);
  try {
    inspectOgJpeg(bytes, OG_BUDGET_BYTES);
  } catch (e) {
    throw new Error(`${path}: ${(e as Error).message}`);
  }
  return { bytes, key: `brand-card.${hash8(bytes)}.jpg`, quality: 0 };
}

export function loadBadge(path: string): Buffer {
  return readFileSync(path);
}
