/**
 * Builds the 8 static link-preview images of events without a cover (slice 14): `apps/web/public/tone-og/{0..7}.jpg`.
 * Build-time only (sharp, Node): never imported by the Worker. Run `npm run build:tone-og` when the colour cover art or
 * the badge changes, and COMMIT the outputs (they are not generated at deploy time). Re-running with unchanged inputs
 * writes identical files.
 *
 * Each image: the colour cover of that tone (`fallbackCoverSvg`, the same builder the web uses, so the on-screen cover
 * and the preview cannot drift) rendered at 1200x630, the Atlas badge at its slice 04 position, baseline JPEG q85,
 * checked with the same inspector the uploads use (`inspectOgJpeg`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { TONE_COUNT, fallbackCoverSvg } from "@atlas/contract";
import { BADGE, loadBadge } from "./og-image.ts";
import { OG_BUDGET_BYTES, OG_HEIGHT, OG_WIDTH, inspectOgJpeg } from "./jpeg-safety.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const outDir = join(repoRoot, "apps/web/public/tone-og");

const badgePng = loadBadge(join(repoRoot, "design/assets/og/badge.png"));
const badgeMeta = await sharp(badgePng).metadata();
if (badgeMeta.width !== BADGE.width || badgeMeta.height !== BADGE.height) {
  throw new Error(`badge must be ${BADGE.width}x${BADGE.height}, got ${badgeMeta.width}x${badgeMeta.height}`);
}

mkdirSync(outDir, { recursive: true });
for (let tone = 0; tone < TONE_COUNT; tone++) {
  const svg = Buffer.from(fallbackCoverSvg(tone, { size: { width: OG_WIDTH, height: OG_HEIGHT } }));
  const base = await sharp(svg, { density: 72 }).resize(OG_WIDTH, OG_HEIGHT, { fit: "fill" }).flatten({ background: "#ffffff" }).toColourspace("srgb").png().toBuffer();
  // No withMetadata(): sharp strips all metadata by default.
  const bytes = await sharp(base)
    .composite([{ input: Buffer.from(badgePng), left: BADGE.left, top: BADGE.top }])
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .jpeg({ quality: 85, progressive: false, chromaSubsampling: "4:2:0", optimiseCoding: true, trellisQuantisation: true, overshootDeringing: true, quantisationTable: 3 })
    .toBuffer();
  inspectOgJpeg(bytes, OG_BUDGET_BYTES); // 1200x630, baseline, no metadata segments, within budget
  writeFileSync(join(outDir, `${tone}.jpg`), bytes);
  console.log(`tone ${tone}: ${bytes.length} bytes`);
}
console.log(`Wrote ${TONE_COUNT} images to ${outDir}`);
