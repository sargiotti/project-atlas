import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { z } from "zod";
import {
  DAY_START_REGEX,
  DEFAULT_DAY_START,
  MAX_POINTS_PER_MAP,
  MAX_SESSIONS_PER_EVENT,
  addDays,
  contentLanguageSchema,
  formatUtcInstant,
  localToUtc,
  mapThemeSchema,
  parseUtcInstant,
  pointCategorySchema,
  sessionSchema,
  slugSchema,
  timeZoneSchema,
  type Session,
} from "@atlas/contract";
import { findSvgViolations, readViewBox } from "./svg-safety.ts";
import { COVER_LIMITS, MAP_LIMITS, inspectWebp } from "./webp-safety.ts";

const round2 = (n: number) => Math.round(n * 100) / 100;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// No control characters (incl. NUL) in any seeded text.
const text = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s), "control characters not allowed");

// Single-line display text that ends up in HTML meta tags (slice 04, R2): additionally rejects every C0
// control (tab, CR, LF too), DEL and C1 controls, zero-width characters, line/paragraph separators and
// bidi overrides/isolates (Trojan-source style spoofing in link previews), and angle brackets.
const displayText = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .refine((s) => !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/.test(s), "control, zero-width or bidi characters not allowed")
    .refine((s) => !/[<>]/.test(s), "angle brackets not allowed");

const seedPointSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  name: text(1, 80),
  category: pointCategorySchema,
  description: text(0, 500),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, "Expected YYYY-MM-DDTHH:MM (event local time)");

/** A programme item, authored in the Event's local wall-clock time; converted to UTC when seeding. */
const seedSessionSchema = z.strictObject({
  /** Stored id is `{slug}-s-{id}`. */
  id: z.string().regex(/^[a-z0-9_-]{1,30}$/),
  /** Seed id of a point of this file. */
  point: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  title: z.string(),
  start: localDateTime,
  end: localDateTime,
  description: z.string().optional(),
});

export const seedFileSchema = z
  .strictObject({
    event: z.strictObject({
      slug: slugSchema,
      name: displayText(1, 120),
      dates: z.strictObject({ start: isoDate, end: isoDate }),
      /** Plain text, stored as written (not translated). */
      city: displayText(1, 80),
      /** ISO 3166-1 alpha-2. */
      country: z.string().regex(/^[A-Z]{2}$/),
      /** City-level coordinates (both or neither), rounded to 2 decimals. Domain only, never public. */
      latitude: z.number().finite().min(-90).max(90).transform(round2).optional(),
      longitude: z.number().finite().min(-180).max(180).transform(round2).optional(),
      /**
       * Declared dims of the cover master. The file lives in the covers folder as `{slug}.webp`.
       * When the file is not there yet the event is seeded with `cover: null`.
       */
      cover: z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
      language: contentLanguageSchema,
      mapTheme: mapThemeSchema,
      /** IANA zone of the Event. */
      timeZone: timeZoneSchema,
      dayStart: z.string().regex(DAY_START_REGEX).default(DEFAULT_DAY_START),
    }),
    map: z.strictObject({
      file: z.string().regex(/^[A-Za-z0-9._-]+\.(svg|webp)$/),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    points: z.array(seedPointSchema).min(1).max(MAX_POINTS_PER_MAP),
    sessions: z.array(seedSessionSchema).max(MAX_SESSIONS_PER_EVENT).default([]),
  })
  .superRefine((seed, ctx) => {
    if ((seed.event.latitude === undefined) !== (seed.event.longitude === undefined)) {
      ctx.addIssue({ code: "custom", message: "latitude and longitude must be given together" });
    }
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

/**
 * Converts the seed's local-time sessions to contract sessions (UTC) and validates them against the contract
 * (text rules, end > start, at most 24 h) and the Event (start within its dates, point in this file, unique ids).
 */
export function resolveSessions(seed: SeedFile): Session[] {
  const { slug, timeZone, dates } = seed.event;
  const pointIds = new Set(seed.points.map((p) => p.id));
  const from = localToUtc(dates.start, "00:00", timeZone);
  const until = localToUtc(addDays(dates.end, 1), "00:00", timeZone);
  const ids = new Set<string>();
  return seed.sessions.map((s) => {
    if (!pointIds.has(s.point)) throw new Error(`${slug}: session ${s.id} refers to unknown point ${s.point}`);
    if (ids.has(s.id)) throw new Error(`${slug}: duplicate session id ${s.id}`);
    ids.add(s.id);
    const at = (local: string) => formatUtcInstant(localToUtc(local.slice(0, 10), local.slice(11), timeZone));
    const candidate = {
      id: `${slug}-s-${s.id}`,
      pointId: `${slug}-${s.point}`,
      title: s.title,
      start: at(s.start),
      end: at(s.end),
      ...(s.description ? { description: s.description } : {}),
    };
    const parsed = sessionSchema.safeParse(candidate);
    if (!parsed.success) throw new Error(`${slug}: invalid session ${s.id}
${z.prettifyError(parsed.error)}`);
    const start = parseUtcInstant(parsed.data.start)!;
    if (start < from || start >= until) throw new Error(`${slug}: session ${s.id} starts outside the event dates`);
    return parsed.data;
  });
}

export interface LoadedSeed {
  source: string;
  seed: SeedFile;
  format: "svg" | "webp";
  /** Validated image bytes to publish (WebP has EXIF/XMP stripped). */
  bytes: Buffer;
  hash8: string;
  imageKey: string; // `{slug}.{hash8}.{svg|webp}`
  /** Validated cover, or null when none is declared or its file is not in the covers folder yet. */
  cover: LoadedCover | null;
}

export interface LoadedCover {
  bytes: Buffer;
  width: number;
  height: number;
  key: string; // `{slug}.{hash8}.webp`
}

/** Reads, validates (own declared dims, cover caps) and strips the cover. Null when absent. */
export function loadCover(
  slug: string,
  declared: { width: number; height: number } | undefined,
  coversDir: string | undefined,
): LoadedCover | null {
  if (!declared || !coversDir) return null;
  const file = join(coversDir, `${slug}.webp`);
  if (!existsSync(file)) {
    console.warn(`No cover for ${slug} (${file} not found): seeding with cover = null.`);
    return null;
  }
  let info;
  try {
    info = inspectWebp(readFileSync(file), {
      ...COVER_LIMITS,
      expectedWidth: declared.width,
      expectedHeight: declared.height,
    });
  } catch (e) {
    throw new Error(`${file}: unsafe cover WebP: ${(e as Error).message}`);
  }
  const hash8 = createHash("sha256").update(info.cleaned).digest("hex").slice(0, 8);
  return { bytes: info.cleaned, width: info.width, height: info.height, key: `${slug}.${hash8}.webp` };
}

export function loadSeed(jsonPath: string, coversDir?: string): LoadedSeed {
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
      info = inspectWebp(raw, { ...MAP_LIMITS, expectedWidth: seed.map.width, expectedHeight: seed.map.height });
    } catch (e) {
      throw new Error(`${svgPath}: unsafe WebP: ${(e as Error).message}`);
    }
    bytes = info.cleaned;
  }

  const hash8 = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
  return {
    source: jsonAbs,
    seed,
    format,
    bytes,
    hash8,
    imageKey: `${seed.event.slug}.${hash8}.${format}`,
    cover: loadCover(seed.event.slug, seed.event.cover, coversDir),
  };
}

function loadDir(dir: string, coversDir?: string): LoadedSeed[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".points.json"))
    .sort();
  if (files.length === 0) throw new Error(`No *.points.json files found in ${dir}`);
  const loaded = files.map((f) => loadSeed(join(dir, f), coversDir));
  const slugs = new Set<string>();
  for (const l of loaded) {
    if (slugs.has(l.seed.event.slug)) throw new Error(`Duplicate event slug: ${l.seed.event.slug}`);
    slugs.add(l.seed.event.slug);
  }
  return loaded;
}

/** Loads one or more seed folders. A slug seeded by a later folder replaces the earlier one. */
export function loadAllSeeds(dirs: string | string[], coversDir?: string): LoadedSeed[] {
  const bySlug = new Map<string, LoadedSeed>();
  for (const dir of Array.isArray(dirs) ? dirs : [dirs]) {
    for (const l of loadDir(dir, coversDir)) bySlug.set(l.seed.event.slug, l);
  }
  return [...bySlug.values()].sort((a, b) => a.seed.event.slug.localeCompare(b.seed.event.slug));
}

/**
 * SQL string literal. SEED-ONLY (N3): operator-run, from reviewed files. Never reuse this string
 * building for HTTP writes; request-driven writes must use bound parameters.
 * Inputs are already validated; quotes are doubled for safety.
 */
const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
/** Validated, finite, range-checked numbers only (see seedFileSchema); fixed 2 decimals, never exponent form. */
const coord = (n: number | undefined) => (n === undefined ? "NULL" : n.toFixed(2));
const NOW = "(strftime('%s','now') * 1000)";

/**
 * Idempotent statements: upsert event and map, then delete + reinsert the map's points.
 * Deterministic ids: evt_{slug}, map_{slug}_1, {slug}-{seedId}.
 */
export function buildSeedStatements(seeds: LoadedSeed[], ogKeys: ReadonlyMap<string, string> = new Map()): string[] {
  const out: string[] = [];
  for (const { seed, imageKey, format, cover } of seeds) {
    const { slug } = seed.event;
    const eventId = `evt_${slug}`;
    const mapId = `map_${slug}_1`;
    out.push(
      `INSERT INTO events (id, slug, name, start_date, end_date, city, country, latitude, longitude, cover_key, cover_width, cover_height, og_key, language, time_zone, day_start, created_at, updated_at) VALUES (${q(eventId)}, ${q(slug)}, ${q(seed.event.name)}, ${q(seed.event.dates.start)}, ${q(seed.event.dates.end)}, ${q(seed.event.city)}, ${q(seed.event.country)}, ${coord(seed.event.latitude)}, ${coord(seed.event.longitude)}, ${cover ? q(cover.key) : "NULL"}, ${cover ? cover.width : "NULL"}, ${cover ? cover.height : "NULL"}, ${ogKeys.has(slug) ? q(ogKeys.get(slug)!) : "NULL"}, ${q(seed.event.language)}, ${q(seed.event.timeZone)}, ${q(seed.event.dayStart)}, ${NOW}, ${NOW}) ON CONFLICT(slug) DO UPDATE SET time_zone = excluded.time_zone, day_start = excluded.day_start, name = excluded.name, start_date = excluded.start_date, end_date = excluded.end_date, city = excluded.city, country = excluded.country, latitude = excluded.latitude, longitude = excluded.longitude, cover_key = excluded.cover_key, cover_width = excluded.cover_width, cover_height = excluded.cover_height, og_key = excluded.og_key, language = excluded.language, updated_at = ${NOW}`,
      `INSERT INTO event_maps (id, event_id, position, width, height, theme, image_key, image_format, created_at, updated_at) VALUES (${q(mapId)}, ${q(eventId)}, 1, ${seed.map.width}, ${seed.map.height}, ${q(seed.event.mapTheme)}, ${q(imageKey)}, ${q(format)}, ${NOW}, ${NOW}) ON CONFLICT(id) DO UPDATE SET width = excluded.width, height = excluded.height, theme = excluded.theme, image_key = excluded.image_key, image_format = excluded.image_format, updated_at = ${NOW}`,
      // Sessions first (they reference points); also covers sessions of a previous seed of this event.
      `DELETE FROM point_sessions WHERE event_id = ${q(eventId)}`,
      `DELETE FROM points WHERE map_id = ${q(mapId)}`,
    );
    for (const p of seed.points) {
      out.push(
        `INSERT INTO points (id, map_id, category, name, description, x, y, created_at, updated_at) VALUES (${q(`${slug}-${p.id}`)}, ${q(mapId)}, ${q(p.category)}, ${q(p.name)}, ${q(p.description)}, ${p.x}, ${p.y}, ${NOW}, ${NOW})`,
      );
    }
    for (const sess of resolveSessions(seed)) {
      out.push(
        `INSERT INTO point_sessions (id, event_id, point_id, title, description, start_utc, end_utc, created_at, updated_at) VALUES (${q(sess.id)}, ${q(eventId)}, ${q(sess.pointId)}, ${q(sess.title)}, ${sess.description === undefined ? "NULL" : q(sess.description)}, ${q(sess.start)}, ${q(sess.end)}, ${NOW}, ${NOW})`,
      );
    }
  }
  return out;
}
