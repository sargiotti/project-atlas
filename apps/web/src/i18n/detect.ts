import { DEFAULT_LANG, LANGS, type Lang } from "./messages";

const STORAGE_KEY = "atlas.lang";

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (LANGS as readonly string[]).includes(v);
}

/**
 * First browser language (in preference order) whose primary subtag is in the allowlist.
 * Anything else, or nothing, falls back to Spanish.
 */
export function pickLang(browserLangs: readonly string[] | undefined | null): Lang {
  for (const tag of browserLangs ?? []) {
    const primary = String(tag).toLowerCase().split(/[-_]/)[0];
    if (isLang(primary)) return primary;
  }
  return DEFAULT_LANG;
}

export function loadStoredLang(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

export function storeLang(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable: the choice just lasts for this visit */
  }
}

export function initialLang(): Lang {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const langs = nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : [];
  return loadStoredLang() ?? pickLang(langs);
}

/**
 * Organizer panel default (slice 07): the first browser language whose language part is en, es, da or ca,
 * otherwise English (the visitor default stays Spanish). An explicit stored choice wins.
 */
export function pickPanelLang(browserLangs: readonly string[] | undefined | null): Lang {
  for (const tag of browserLangs ?? []) {
    const primary = String(tag).toLowerCase().split(/[-_]/)[0];
    if (isLang(primary)) return primary;
  }
  return "en";
}

export function initialPanelLang(): Lang {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const langs = nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : [];
  return loadStoredLang() ?? pickPanelLang(langs);
}

/**
 * Spanish variant (slice 30): true when the first Spanish entry of the browser's language list is es-AR or es-UY
 * (rioplatense vos). Any other Spanish (es-ES, es-MX, plain es) keeps the base tú copy.
 */
export function pickVos(browserLangs: readonly string[] | undefined | null): boolean {
  for (const tag of browserLangs ?? []) {
    const parts = String(tag).toLowerCase().split(/[-_]/);
    if (parts[0] === "es") return parts[1] === "ar" || parts[1] === "uy";
  }
  return false;
}

export function prefersVos(): boolean {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  return pickVos(nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : []);
}
