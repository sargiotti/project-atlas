/**
 * Slice 08b: one shared definition of the invisible and direction-changing characters that never belong in
 * user text. The text schemas (`panel-events.ts`, `map-bundle.ts`), the link-preview cleaner in the API and the
 * moderation reason cleaner all build their regular expressions from `INVISIBLE_RANGES`, so they cannot drift.
 * Ranges are inclusive Unicode code points; the expressions that use them need the `u` flag.
 */
export const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00ad, 0x00ad], // soft hyphen
  [0x034f, 0x034f], // combining grapheme joiner
  [0x061c, 0x061c], // Arabic letter mark (bidi)
  [0x115f, 0x1160], // Hangul choseong / jungseong fillers
  [0x17b4, 0x17b5], // Khmer inherent vowels (invisible)
  [0x180e, 0x180e], // Mongolian vowel separator
  [0x200b, 0x200f], // zero-width space, ZWNJ, ZWJ, LRM, RLM
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2060, 0x206f], // word joiner, invisible operators, bidi isolates, deprecated format characters
  [0x3164, 0x3164], // Hangul filler
  [0xfeff, 0xfeff], // BOM / zero-width no-break space
  [0xffa0, 0xffa0], // halfwidth Hangul filler
  [0xfff9, 0xfffb], // interlinear annotation anchors
  [0xe0000, 0xe007f], // tag characters (tag smuggling)
];

const hex = (n: number) => String.raw`\u` + `{${n.toString(16)}}`;
const rangeSource = (a: number, b: number) => (a === b ? hex(a) : `${hex(a)}-${hex(b)}`);

/** Body of a character class (no brackets) for `INVISIBLE_RANGES`. */
export const INVISIBLE_CLASS_SOURCE: string = INVISIBLE_RANGES.map(([a, b]) => rangeSource(a, b)).join("");

/** U+2028 / U+2029: line and paragraph separators. Forbidden in fields, but plain whitespace when cleaning. */
const LINE_SEPARATORS_SOURCE = rangeSource(0x2028, 0x2029);

/** C0 controls except TAB, LF, CR, plus C1 controls and DEL. Whitespace controls are collapsed separately. */
export const CONTROL_STRIP_SOURCE = `${rangeSource(0x00, 0x08)}${rangeSource(0x0b, 0x0c)}${rangeSource(0x0e, 0x1f)}${rangeSource(0x7f, 0x9f)}`;

/** Single-line text fields: every control (including `\n`), DEL, C1, separators and the invisible set. */
export const FORBIDDEN_SINGLE_LINE = new RegExp(`[${rangeSource(0x00, 0x1f)}${rangeSource(0x7f, 0x9f)}${LINE_SEPARATORS_SOURCE}${INVISIBLE_CLASS_SOURCE}]`, "u");
/** Multi-line text fields: the same, but `\n` is allowed. */
export const FORBIDDEN_MULTI_LINE = new RegExp(
  `[${rangeSource(0x00, 0x09)}${rangeSource(0x0b, 0x1f)}${rangeSource(0x7f, 0x9f)}${LINE_SEPARATORS_SOURCE}${INVISIBLE_CLASS_SOURCE}]`,
  "u",
);

/** What the one-line cleaners drop: non-whitespace controls, the invisible set, `<` and `>`. */
export const CLEAN_STRIP = new RegExp(`[${CONTROL_STRIP_SOURCE}${INVISIBLE_CLASS_SOURCE}${rangeSource(0x3c, 0x3c)}${rangeSource(0x3e, 0x3e)}]`, "gu");

// --- Moderation reason (reject / admin unpublish) ---------------------------------------------------------
export const REASON_MAX = 200;

/** NFC, strip invisible characters and `<` `>`, collapse whitespace, trim. */
export function cleanReason(input: string): string {
  return input.normalize("NFC").replace(CLEAN_STRIP, "").replace(/\s+/g, " ").trim();
}

/** Length as the server and the form count it: Unicode code points, not UTF-16 units. */
export const codePointLength = (s: string): number => Array.from(s).length;
