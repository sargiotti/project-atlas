import { billboardEventSchema, eventSummaryBaseSchema, type Billboard } from "@atlas/contract";
import { groupBillboard } from "../domain/billboard";
import { isNearby, type VisitorLocation } from "../domain/nearby";
import { toEventSummary, type StoredEventSummary } from "../domain/event-list";

/** Port. Published events whose end date is on or after `minEndDate`, by start date, slug, capped by the contract. */
export interface BillboardRepository {
  listCurrent(minEndDate: string): Promise<StoredEventSummary[]>;
}

interface SharedRow {
  summary: ReturnType<typeof eventSummaryBaseSchema.parse>;
  isDemo: boolean;
  timeZone: string;
  lat: number | null;
  lng: number | null;
}

const CACHE_TTL_MS = 60_000;
// Isolate-level cache of SHARED rows only (same rules as list-events): identical for every visitor, no visitor
// location, frozen. `nearby` and the grouping are computed per request on fresh copies.
let cached: { at: number; rows: readonly SharedRow[] } | null = null;

export function clearBillboardCache(): void {
  cached = null;
}

/**
 * Lower bound for the SQL end-date filter: yesterday in UTC. No time zone is more than 14 hours from UTC, so an event
 * that has not ended where it takes place is never dropped here; the exact test is made per event in the domain.
 */
export const minEndDateFor = (nowMs: number): string => new Date(nowMs - 86_400_000).toISOString().slice(0, 10);

async function sharedRows(repo: BillboardRepository, now: number): Promise<readonly SharedRow[]> {
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.rows;
  const stored = await repo.listCurrent(minEndDateFor(now));
  const rows = Object.freeze(
    stored.map((s) =>
      Object.freeze({
        summary: Object.freeze(eventSummaryBaseSchema.parse(toEventSummary(s))),
        isDemo: s.isDemo === true,
        timeZone: s.timeZone ?? "UTC",
        lat: s.latitude,
        lng: s.longitude,
      }),
    ),
  );
  cached = { at: now, rows };
  return rows;
}

export async function getBillboard(repo: BillboardRepository, visitor: VisitorLocation, now: number = Date.now()): Promise<Billboard> {
  const rows = await sharedRows(repo, now);
  const windows = groupBillboard(
    rows.map((r) => ({
      event: billboardEventSchema.parse({
        ...r.summary,
        nearby: isNearby(visitor, { country: r.summary.country, lat: r.lat, lng: r.lng }),
        isDemo: r.isDemo,
      }),
      timeZone: r.timeZone,
    })),
    now,
  );
  return { windows };
}
