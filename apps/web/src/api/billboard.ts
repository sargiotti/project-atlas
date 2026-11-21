import { billboardSchema, placeIdSchema, type Billboard, type PlaceId } from "@atlas/contract";
import { nearOverride } from "./events";

export type BillboardResult = { status: "ok"; billboard: Billboard } | { status: "error" };

const PLACE_KEY = "atlas.place";

/** The remembered place: the id only, re-validated against the contract list on every read. */
export function loadPlace(): PlaceId | null {
  try {
    const r = placeIdSchema.safeParse(window.localStorage.getItem(PLACE_KEY));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function storePlace(id: PlaceId | null) {
  try {
    if (id) window.localStorage.setItem(PLACE_KEY, id);
    else window.localStorage.removeItem(PLACE_KEY);
  } catch {
    /* storage can be blocked: the choice then lasts for this visit only */
  }
}

/** `place` is a contract-validated id; `near` is the slice 03 test override. Both go through URLSearchParams. */
export async function fetchBillboard(place: PlaceId | null, signal?: AbortSignal): Promise<BillboardResult> {
  try {
    const params = new URLSearchParams();
    const checked = place ? placeIdSchema.safeParse(place) : null;
    if (checked?.success) params.set("place", checked.data);
    const near = nearOverride(window.location.search);
    if (near) params.set("near", near);
    const qs = params.toString();
    const res = await fetch(`/api/v1/billboard${qs ? `?${qs}` : ""}`, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) return { status: "error" };
    return { status: "ok", billboard: billboardSchema.parse(await res.json()) };
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    return { status: "error" };
  }
}
