import { NEAR_OVERRIDE_REGEX } from "@atlas/contract";

/** Events within this great-circle distance of the visitor are "nearby". */
export const NEARBY_RADIUS_KM = 300;

const EARTH_RADIUS_KM = 6371;

/** What is known about the visitor. Each part may be missing. Never stored, never returned. */
export interface VisitorLocation {
  country?: string;
  lat?: number;
  lng?: number;
}

/** What is known about an event's place (domain only, never public). */
export interface EventPlace {
  country: string;
  lat: number | null;
  lng: number | null;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km (haversine). */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Both have coordinates: within the radius. Otherwise both countries known: same country.
 * Unknown location: false.
 */
export function isNearby(visitor: VisitorLocation, event: EventPlace): boolean {
  if (visitor.lat !== undefined && visitor.lng !== undefined && event.lat !== null && event.lng !== null) {
    return haversineKm(visitor.lat, visitor.lng, event.lat, event.lng) <= NEARBY_RADIUS_KM;
  }
  return visitor.country !== undefined && visitor.country === event.country;
}

const UNKNOWN_COUNTRIES = new Set(["XX", "T1"]); // Cloudflare: unknown / Tor

const validCountry = (v: unknown): string | undefined =>
  typeof v === "string" && /^[A-Z]{2}$/.test(v) && !UNKNOWN_COUNTRIES.has(v) ? v : undefined;

const validCoord = (v: unknown, limit: number): number | undefined => {
  if (typeof v === "string" ? v.trim() === "" : typeof v !== "number") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : undefined;
};

/**
 * Reads the visitor's coarse location from Cloudflare's `request.cf`. Each invalid or missing part is
 * simply unknown. Never throws and never logs; the values never leave this function except as the result.
 */
export function parseVisitorLocation(cf: unknown): VisitorLocation {
  try {
    if (typeof cf !== "object" || cf === null) return {};
    const raw = cf as Record<string, unknown>;
    const out: VisitorLocation = {};
    const country = validCountry(raw.country);
    if (country) out.country = country;
    const lat = validCoord(raw.latitude, 90);
    const lng = validCoord(raw.longitude, 180);
    if (lat !== undefined && lng !== undefined) {
      out.lat = lat;
      out.lng = lng;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Applies the `?near=` override. A valid value is never echoed.
 * - null or invalid: the real location is used unchanged
 * - `none`: unknown location
 * - XX code: that country replaces the real one; coordinates are treated as absent
 */
export function applyNearOverride(real: VisitorLocation, nearParam: string | null): VisitorLocation {
  if (nearParam === null) return real;
  const value = nearParam.toUpperCase();
  if (!NEAR_OVERRIDE_REGEX.test(value)) return real;
  if (value === "NONE") return {};
  return { country: value };
}
