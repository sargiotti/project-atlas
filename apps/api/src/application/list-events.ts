import { eventSummaryBaseSchema, type EventList, type EventSummaryBase } from "@atlas/contract";
import { isNearby, type VisitorLocation } from "../domain/nearby";
import { toEventSummary, type StoredEventSummary } from "../domain/event-list";

/** Port. Implemented by the D1 adapter. Returns at most the contract cap, ordered by start_date, slug. */
export interface EventListRepository {
  listSummaries(): Promise<StoredEventSummary[]>;
}

interface SharedRow {
  summary: EventSummaryBase;
  lat: number | null;
  lng: number | null;
}

const CACHE_TTL_MS = 60_000;
// Isolate-level cache of SHARED rows only: identical for every visitor, no visitor location, never
// mutated after it is stored. `nearby` is computed per request on fresh copies. Cuts D1 reads on
// workers.dev, where the Cache API does nothing.
let cached: { at: number; rows: readonly SharedRow[] } | null = null;

export function clearListEventsCache(): void {
  cached = null;
}

async function sharedRows(repo: EventListRepository, now: number): Promise<readonly SharedRow[]> {
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.rows;
  const stored = await repo.listSummaries();
  const rows = Object.freeze(
    stored.map((s) =>
      Object.freeze({
        // Output validation: never serve a payload that breaks the contract (also strips unknown keys).
        summary: Object.freeze(eventSummaryBaseSchema.parse(toEventSummary(s))),
        lat: s.latitude,
        lng: s.longitude,
      }),
    ),
  );
  cached = { at: now, rows };
  return rows;
}

/** The event list for one visitor: shared rows plus a per-request `nearby` flag. */
export async function listEvents(
  repo: EventListRepository,
  visitor: VisitorLocation,
  now: number = Date.now(),
): Promise<EventList> {
  const rows = await sharedRows(repo, now);
  return rows.map((r) => ({
    ...r.summary,
    nearby: isNearby(visitor, { country: r.summary.country, lat: r.lat, lng: r.lng }),
  }));
}
