import { orgPageCa, orgPageDa, orgPageEn, orgPageEs, type OrganizerPageStrings } from "./organizer-page-messages.ts";

/**
 * Slice 42, ADR 0017: the organizer page has one URL per language. This table is the single source of truth for the
 * Worker (HTML, canonical, hreflang, sitemap) and the web app (URL to language, flag navigation). Paths are exact:
 * the only variant also served is the same path with one trailing slash (the canonical is always the no-slash path).
 */
export const ORGANIZER_LANGS = ["es", "en", "ca", "da"] as const;
export type OrganizerLang = (typeof ORGANIZER_LANGS)[number];

export interface OrganizerRoute {
  readonly lang: OrganizerLang;
  /** Canonical path, no trailing slash. */
  readonly path: string;
  /** false: served with noindex, no hreflang, not in the sitemap (Danish until slice 45). */
  readonly indexable: boolean;
}

export const ORGANIZER_ROUTES: readonly OrganizerRoute[] = [
  { lang: "es", path: "/organizadores", indexable: true },
  { lang: "en", path: "/en/organizers", indexable: true },
  { lang: "ca", path: "/ca/organitzadors", indexable: true },
  { lang: "da", path: "/da/arrangorer", indexable: false },
];

/** hreflang x-default points at this language's URL. */
export const ORGANIZER_X_DEFAULT_LANG: OrganizerLang = "en";

/** Anchor id of the request form, the same in every language. */
export const ORGANIZER_FORM_ID = "pedi-tu-mapa";

/** Exact-match lookup (allowlist): a path or the path plus one trailing slash. Anything else is null. */
export function organizerRouteForPath(path: string): OrganizerRoute | null {
  for (const r of ORGANIZER_ROUTES) if (path === r.path || path === `${r.path}/`) return r;
  return null;
}

export function organizerPathForLang(lang: OrganizerLang): string {
  return ORGANIZER_ROUTES.find((r) => r.lang === lang)!.path;
}

export const ORGANIZER_PAGE_STRINGS: Record<OrganizerLang, OrganizerPageStrings> = {
  es: orgPageEs,
  en: orgPageEn,
  ca: orgPageCa,
  da: orgPageDa,
};
