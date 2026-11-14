import { POINT_CATEGORIES, mapBundleSchema, slugSchema, type MapBundle } from "@atlas/contract";

/** Image variants (ascending by width) whose URLs are same-origin paths; anything else is dropped. */
export function safeVariants(variants: { url: string; width: number }[]): { url: string; width: number }[] {
  return variants.filter((v) => safeImageUrl(v.url)).sort((a, b) => a.width - b.width);
}

export type BundleResult =
  | { status: "ok"; bundle: MapBundle; imageUrl: string }
  | { status: "not-found" }
  | { status: "unavailable"; retryAfter?: number };

/** The map image must come from our own origin (the CSP only allows 'self'). */
export function safeImageUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  return url.startsWith("/") && !url.startsWith("//") && !url.includes("\\") ? url : null;
}

/** Client-side validation is for UX only (skip a pointless request); the server is the authority. */
export function isValidSlug(slug: string) {
  return slugSchema.safeParse(slug).success;
}

/**
 * Forward compatibility: a category this build does not know (added later) must not black out the whole map.
 * It is shown as the generic "info" marker instead. The contract schema itself stays strict.
 */
export function withKnownCategories(raw: unknown): unknown {
  const points = (raw as any)?.points;
  if (!Array.isArray(points)) return raw;
  const known = new Set<string>(POINT_CATEGORIES);
  return {
    ...(raw as object),
    points: points.map((p) => (p && typeof p === "object" && typeof p.category === "string" && !known.has(p.category) ? { ...p, category: "info" } : p)),
  };
}

export async function fetchMapBundle(slug: string, signal?: AbortSignal): Promise<BundleResult> {
  if (!isValidSlug(slug)) return { status: "not-found" };
  let res: Response;
  try {
    res = await fetch(`/api/v1/events/${slug}/map-bundle`, { signal, headers: { Accept: "application/json" } });
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    return { status: "unavailable" };
  }

  if (res.status === 400 || res.status === 404) return { status: "not-found" };
  if (res.status === 429) {
    const ra = Number(res.headers.get("Retry-After"));
    return { status: "unavailable", retryAfter: Number.isFinite(ra) && ra > 0 ? ra : undefined };
  }
  if (!res.ok) return { status: "unavailable" };

  try {
    const bundle = mapBundleSchema.parse(withKnownCategories(await res.json()));
    const imageUrl = safeImageUrl(bundle.map.image.variants[0]?.url);
    if (!imageUrl) return { status: "unavailable" };
    return { status: "ok", bundle, imageUrl };
  } catch {
    // The response does not match the contract: treat it as a broken backend, not a broken page.
    return { status: "unavailable" };
  }
}
