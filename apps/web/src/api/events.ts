import { eventListSchema, NEAR_OVERRIDE_REGEX, type EventSummary } from "@atlas/contract";

export type EventsResult = { status: "ok"; events: EventSummary[] } | { status: "error" };

/**
 * Test override (slice 03): `?near=` is read from the page URL, uppercased and forwarded only when it
 * matches the contract regex. Never rendered, never stored, never sent anywhere else.
 */
export function nearOverride(search: string): string | null {
  const raw = new URLSearchParams(search).get("near")?.toUpperCase();
  return raw && NEAR_OVERRIDE_REGEX.test(raw) ? raw : null;
}

/** 429, 5xx, network failures and contract mismatches all collapse into one error state. No retries here. */
export async function fetchEvents(signal?: AbortSignal): Promise<EventsResult> {
  try {
    const near = nearOverride(window.location.search);
    const qs = near ? `?${new URLSearchParams({ near })}` : "";
    const res = await fetch(`/api/v1/events${qs}`, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) return { status: "error" };
    return { status: "ok", events: eventListSchema.parse(await res.json()) };
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    return { status: "error" };
  }
}
