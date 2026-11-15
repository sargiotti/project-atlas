import { normalize } from "./search";

type Translate = (key: any) => string;
type Labelled = { name?: string | null; category: string };

/**
 * The one place that turns a Point into the text people read (slice 08c, nullable name).
 * A custom name is shown as-is; without one the category label is shown in the viewer's UI language
 * (never stored, never the event language). Used by the visitor map, list, sheet, schedule, preview and the editor.
 */
export function displayName(p: Labelled, t: Translate): string {
  return p.name || t(`cat_${p.category}`);
}

/** Marker / button label for screen readers: "Main stage, Stage", or just "Toilets" when there is no custom name. */
export function pointAriaLabel(p: Labelled, categoryLabel: (c: string) => string): string {
  const cat = categoryLabel(p.category);
  return p.name ? `${p.name}, ${cat}` : cat;
}

/** Searchable text: the localized category label plus the custom name, normalized like `lib/search.ts`. */
export function pointSearchText(p: Labelled, t: Translate): string {
  return normalize(`${t(`cat_${p.category}`)} ${p.name ?? ""}`);
}

/** Sort by display name in the viewer's language (the server cannot: it does not know the label). */
export function byDisplayName<T extends Labelled>(t: Translate, lang: string) {
  return (a: T, b: T) => displayName(a, t).localeCompare(displayName(b, t), lang, { sensitivity: "base" });
}
