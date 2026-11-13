import { eventListSchema, type EventSummary } from "@atlas/contract";

export type EventsResult = { status: "ok"; events: EventSummary[] } | { status: "error" };

/** 429, 5xx, network failures and contract mismatches all collapse into one error state. No retries here. */
export async function fetchEvents(signal?: AbortSignal): Promise<EventsResult> {
  try {
    const res = await fetch("/api/v1/events", { signal, headers: { Accept: "application/json" } });
    if (!res.ok) return { status: "error" };
    return { status: "ok", events: eventListSchema.parse(await res.json()) };
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    return { status: "error" };
  }
}
