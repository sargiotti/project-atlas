/**
 * The one place a Google Maps link is built. Inputs are validated event fields (never `location`); the
 * address goes through URLSearchParams so `&`, `#`, `?` and `%` stay inside the single `query` value.
 * No API key: this is the public search URL.
 */
export function mapsSearchUrl(venueAddress: string | null | undefined, city: string | null | undefined, countryName: string | null | undefined): string | null {
  const address = (venueAddress ?? "").trim();
  if (!address) return null;
  const u = new URL("https://www.google.com/maps/search/");
  u.searchParams.set("api", "1");
  u.searchParams.set("query", [address, city?.trim(), countryName?.trim()].filter(Boolean).join(", "));
  return u.href;
}
