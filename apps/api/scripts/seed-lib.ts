import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { z } from "zod";
import {
  MAX_POINTS_PER_MAP,
  contentLanguageSchema,
  mapThemeSchema,
  pointCategorySchema,
  slugSchema,
} from "@atlas/contract";
import { findSvgViolations, readViewBox } from "./svg-safety.ts";
import { inspectWebp } from "./webp-safety.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// No control characters (incl. NUL) in any seeded text.
const text = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s), "control characters not allowed");

const seedPointSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  name: text(1, 80),
  category: pointCategorySchema,
  description: text(0, 500),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const seedFileSchema = z
  .strictObject({
    event: z.strictObject({
      slug: slugSchema,
      name: text(1, 120),
      dates: z.strictObject({ start: isoDate, end: isoDate }),
      language: contentLanguageSchema,
      mapTheme: mapThemeSchema,
    }),
    map: z.strictObject({
      file: z.string().regex(/^[A-Za-z0-9._-]+\.(svg|webp)$/),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    points: z.array(seedPointSchema).min(1).max(MAX_POINTS_PER_MAP),
  })
  .superRefine((seed, ctx) => {
    if (seed.event.dates.end < seed.event.dates.start) {
      ctx.addIssue({ code: "custom", message: "dates.end must be >= dates.start" });
    }
    const seen = new Set<string>();
    for (const p of seed.points) {
      if (seen.has(p.id)) ctx.addIssue({ code: "custom", message: `duplicate point id: ${p.id}` });
      seen.add(p.id);
      // Stored point id is `{slug}-{seedId}` and must fit the contract's 64 chars.
      if (`${seed.event.slug}-${p.id}`.length > 64) {
        ctx.addIssue({ code: "custom", message: `point id too long once prefixed with slug: ${p.id}` });
      }
    }
  });

export type SeedFile = z.infer<typeof seedFileSchema>;

export interface LoadedSeed {
  source: string;
  seed: SeedFile;
  format: "svg" | "webp";
  /** Validated image bytes to publish (WebP has EXIF/XMP stripped). */
  bytes: Buffer;
  hash8: string;
  imageKey: string; // `{slug}.{hash8}.{svg|webp}`
}

export function loadSeed(jsonPath: string): LoadedSeed {
  const jsonAbs = resolve(jsonPath);
  const parsed = seedFileSchema.safeParse(JSON.parse(readFileSync(jsonAbs, "utf8")));
  if (!parsed.success) {
    throw new Error(`${jsonAbs}: invalid seed file\n${z.prettifyError(parsed.error)}`);
  }
  const seed = parsed.data;

  const folder = dirname(jsonAbs);
  if (isAbsolute(seed.map.file)) throw new Error(`${jsonAbs}: map.file must be relative`);
  const svgPath = resolve(folder, seed.map.file);
  if (!svgPath.startsWith(folder + sep)) throw new Error(`${jsonAbs}: map.file escapes the seed folder`);

  const format = seed.map.file.endsWith(".webp") ? "webp" : "svg";
  const raw = readFileSync(svgPath);
  let bytes: Buffer = raw;
  if (format === "svg") {
    const svgText = raw.toString("utf8");
    const violations = findSvgViolations(svgText);
    if (violations.length) throw new Error(`${svgPath}: unsafe SVG: ${violations.join("; ")}`);
    const box = readViewBox(svgText);
    if (!box) throw new Error(`${svgPath}: missing or unsupported viewBox (expected "0 0 W H")`);
    if (box.width !== seed.map.width || box.height !== seed.map.height) {
      throw new Error(
        `${svgPath}: viewBox ${box.width}x${box.height} does not match map ${seed.map.width}x${seed.map.height}`,
      );
    }
  } else {
    let info;
    try {
      info = inspectWebp(raw);
    } catch (e) {
      throw new Error(`${svgPath}: unsafe WebP: ${(e as Error).message}`);
    }
    if (info.width !== seed.map.width || info.height !== seed.map.height) {
      throw new Error(`${svgPath}: WebP is ${info.width}x${info.height}, does not match map ${seed.map.width}x${seed.map.height}`);
    }
    bytes = info.cleaned;
  }

  const hash8 = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
  return { source: jsonAbs, seed, format, bytes, hash8, imageKey: `${seed.event.slug}.${hash8}.${format}` };
}

function loadDir(dir: string): LoadedSeed[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".points.json"))
    .sort();
  if (files.length === 0) throw new Error(`No *.points.json files found in ${dir}`);
  const loaded = files.map((f) => loadSeed(join(dir, f)));
  const slugs = new Set<string>();
  for (const l of loaded) {
    if (slugs.has(l.seed.event.slug)) throw new Error(`Duplicate event slug: ${l.seed.event.slug}`);
    slugs.add(l.seed.event.slug);
  }
  return loaded;
}

/** Loads one or more seed folders. A slug seeded by a later folder replaces the earlier one. */
export function loadAllSeeds(dirs: string | string[]): LoadedSeed[] {
  const bySlug = new Map<string, LoadedSeed>();
  for (const dir of Array.isArray(dirs) ? dirs : [dirs]) {
    for (const l of loadDir(dir)) bySlug.set(l.seed.event.slug, l);
  }
  return [...bySlug.values()].sort((a, b) => a.seed.event.slug.localeCompare(b.seed.event.slug));
}

/**
 * SQL string literal. SEED-ONLY (N3): operator-run, from reviewed files. Never reuse this string
 * building for HTTP writes; request-driven writes must use bound parameters.
 * Inputs are already validated; quotes are doubled for safety.
 */
const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
const NOW = "(strftime('%s','now') * 1000)";

/**
 * Idempotent statements: upsert event and map, then delete + reinsert the map's points.
 * Deterministic ids: evt_{slug}, map_{slug}_1, {slug}-{seedId}.
 */
export function buildSeedStatements(seeds: LoadedSeed[]): string[] {
  const out: string[] = [];
  for (const { seed, imageKey, format } of seeds) {
    const { slug } = seed.event;
    const eventId = `evt_${slug}`;
    const mapId = `map_${slug}_1`;
    out.push(
      `INSERT INTO events (id, slug, name, start_date, end_date, language, created_at, updated_at) VALUES (${q(eventId)}, ${q(slug)}, ${q(seed.event.name)}, ${q(seed.event.dates.start)}, ${q(seed.event.dates.end)}, ${q(seed.event.language)}, ${NOW}, ${NOW}) ON CONFLICT(slug) DO UPDATE SET name = excluded.name, start_date = excluded.start_date, end_date = excluded.end_date, language = excluded.language, updated_at = ${NOW}`,
      `INSERT INTO event_maps (id, event_id, position, width, height, theme, image_key, image_format, created_at, updated_at) VALUES (${q(mapId)}, ${q(eventId)}, 1, ${seed.map.width}, ${seed.map.height}, ${q(seed.event.mapTheme)}, ${q(imageKey)}, ${q(format)}, ${NOW}, ${NOW}) ON CONFLICT(id) DO UPDATE SET width = excluded.width, height = excluded.height, theme = excluded.theme, image_key = excluded.image_key, image_format = excluded.image_format, updated_at = ${NOW}`,
      `DELETE FROM points WHERE map_id = ${q(mapId)}`,
    );
    for (const p of seed.points) {
      out.push(
        `INSERT INTO points (id, map_id, category, name, description, x, y, created_at, updated_at) VALUES (${q(`${slug}-${p.id}`)}, ${q(mapId)}, ${q(p.category)}, ${q(p.name)}, ${q(p.description)}, ${p.x}, ${p.y}, ${NOW}, ${NOW})`,
      );
    }
  }
  return out;
}
