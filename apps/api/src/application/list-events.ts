import { eventListSchema, type EventList } from "@atlas/contract";
import { toEventSummary, type StoredEventSummary } from "../domain/event-list";

/** Port. Implemented by the D1 adapter. Returns at most the contract cap, ordered by start_date, slug. */
export interface EventListRepository {
  listSummaries(): Promise<StoredEventSummary[]>;
}

const CACHE_TTL_MS = 60_000;
// Isolate-level cache. The list is location-free (identical for every visitor), so one entry is enough.
// Cuts D1 reads on workers.dev, where the Cache API does nothing.
let cached: { at: number; value: EventList } | null = null;

export function clearListEventsCache(): void {
  cached = null;
}

export async function listEvents(repo: EventListRepository, now: number = Date.now()): Promise<EventList> {
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  const stored = await repo.listSummaries();
  // Output validation: never serve a payload that breaks the contract (also strips unknown keys).
  const value = eventListSchema.parse(stored.map(toEventSummary));
  cached = { at: now, value };
  return value;
}
