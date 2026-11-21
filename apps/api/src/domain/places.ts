import { PLACE_PARAM_REGEX, type PlaceId } from "@atlas/contract";
import type { VisitorLocation } from "./nearby";

/** Server-side table behind the `PLACES` ids of `@atlas/contract`: country and city-centre coordinates. Never sent to clients. */
export const PLACE_LOCATIONS: Readonly<Record<PlaceId, Required<VisitorLocation>>> = {
  valencia: { country: "ES", lat: 39.4699, lng: -0.3763 },
  barcelona: { country: "ES", lat: 41.3874, lng: 2.1686 },
  madrid: { country: "ES", lat: 40.4168, lng: -3.7038 },
  copenhagen: { country: "DK", lat: 55.6761, lng: 12.5683 },
  galway: { country: "IE", lat: 53.2707, lng: -9.0568 },
  "buenos-aires": { country: "AR", lat: -34.6037, lng: -58.3816 },
  montevideo: { country: "UY", lat: -34.9011, lng: -56.1645 },
};

/**
 * Resolves `?place=`. A value that is not exactly a known id (wrong shape, unknown, inherited key such as `constructor`)
 * is ignored: the caller keeps the real location. The value is never echoed.
 */
export function placeLocation(param: string | null): VisitorLocation | null {
  if (param === null || !PLACE_PARAM_REGEX.test(param)) return null;
  if (!Object.prototype.hasOwnProperty.call(PLACE_LOCATIONS, param)) return null;
  const { country, lat, lng } = PLACE_LOCATIONS[param as PlaceId];
  return { country, lat, lng };
}
