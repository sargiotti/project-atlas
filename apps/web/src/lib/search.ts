import type { EventSummary } from "@atlas/contract";

export const SEARCH_MAX = 100;

// Letters that NFD does not decompose into base + combining mark.
const SPECIAL: Record<string, string> = {
  "ø": "o", "æ": "ae", "œ": "oe", "å": "a", "ß": "ss", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ı": "i", "ħ": "h",
};
const SPECIAL_RE = /[øæœåßłđðþıħ]/g;
const MARKS_RE = /[̀-ͯ]/g;

/** Case-, accent- and diacritic-insensitive form used for both the query and the searchable text. */
export function normalize(input: string): string {
  return input
    .normalize("NFD")
    .replace(MARKS_RE, "")
    .toLowerCase()
    .replace(SPECIAL_RE, (c) => SPECIAL[c] ?? c)
    .normalize("NFC");
}

/** Trimmed, length-capped query split into normalized words. Never turned into a RegExp. */
export function queryWords(query: string): string[] {
  return normalize(query.trim().slice(0, SEARCH_MAX)).split(/\s+/).filter(Boolean);
}

const SEARCH_LANGS = ["en", "es", "da", "ca"];
const regionCache = new Map<string, string>();

/** Country name in all app languages (en, es, da, ca), joined, whatever the UI language. */
function countryNames(code: string): string {
  let hit = regionCache.get(code);
  if (hit === undefined) {
    const names = new Set<string>([code]);
    for (const l of SEARCH_LANGS) {
      try {
        const n = new Intl.DisplayNames([l], { type: "region" }).of(code);
        if (n) names.add(n);
      } catch {
        // unsupported code or locale: the code itself still matches
      }
    }
    hit = normalize([...names].join(" "));
    regionCache.set(code, hit);
  }
  return hit;
}

export function searchText(e: Pick<EventSummary, "name" | "city" | "country">): string {
  return `${normalize(e.name)} ${normalize(e.city)} ${countryNames(e.country)}`;
}

/** Every word of the query must appear (substring) in the event's name, city or country. */
export function matchesQuery(e: Pick<EventSummary, "name" | "city" | "country">, words: string[]): boolean {
  if (words.length === 0) return true;
  const text = searchText(e);
  return words.every((w) => text.includes(w));
}
