import { buildEventPreview, type EventPreview, type StoredEventPreview } from "../domain/event-preview";

/** Port. Implemented by the D1 adapter. Returns at most MAX_EVENTS_IN_LIST events. */
export interface EventPreviewRepository {
  listPreviews(): Promise<StoredEventPreview[]>;
}

const CACHE_TTL_MS = 60_000;

// Isolate-level cache of every event's preview, loaded by ONE bounded query and refreshed at most every
// 60 s. Lookups by slug are map reads, so unknown slugs never hit D1 and there are no negative entries to
// grow. Public data only, identical for every visitor. Failures are not cached (the caller fails open).
let cached: { at: number; previews: ReadonlyMap<string, EventPreview> } | null = null;
let inflight: Promise<ReadonlyMap<string, EventPreview>> | null = null;

export function clearEventPreviewCache(): void {
  cached = null;
  inflight = null;
}

async function load(repo: EventPreviewRepository, now: number): Promise<ReadonlyMap<string, EventPreview>> {
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.previews;
  inflight ??= repo
    .listPreviews()
    .then((rows) => {
      const previews = new Map(rows.map((r) => [r.slug, Object.freeze(buildEventPreview(r))] as const));
      cached = { at: now, previews };
      return previews;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** The preview for a slug that already passed slug validation, or null when no such event exists. Throws on D1 errors. */
export async function getEventPreview(
  repo: EventPreviewRepository,
  slug: string,
  now: number = Date.now(),
): Promise<EventPreview | null> {
  return (await load(repo, now)).get(slug) ?? null;
}
