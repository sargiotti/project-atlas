/** Slug generation for organizer events: readable base from the name plus a random suffix. */

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export const SLUG_SUFFIX_LENGTH = 6;
const BASE_MAX = 40;
const FALLBACK_BASE = "event";

/** NFKD, no diacritics, lowercase, runs of non [a-z0-9] become "-", cut to 40 chars; "event" when empty. */
export function slugBase(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, BASE_MAX)
    .replace(/-+$/g, "");
  return base || FALLBACK_BASE;
}

/**
 * `length` characters from [a-z0-9] drawn from the random source by rejection sampling: bytes >= 252
 * (the largest multiple of 36 below 256) are discarded, so every character is equally likely.
 */
export function randomSuffix(
  length: number = SLUG_SUFFIX_LENGTH,
  fillRandom: (bytes: Uint8Array) => void = (b) => void crypto.getRandomValues(b),
): string {
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  const buf = new Uint8Array(16);
  while (out.length < length) {
    fillRandom(buf);
    for (const byte of buf) {
      if (byte < limit && out.length < length) out += ALPHABET[byte % ALPHABET.length];
    }
  }
  return out;
}

/** At most 47 characters (40 + "-" + 6), so it always fits `slugSchema`. */
export function generateSlug(name: string, fillRandom?: (bytes: Uint8Array) => void): string {
  return `${slugBase(name)}-${randomSuffix(SLUG_SUFFIX_LENGTH, fillRandom)}`;
}
