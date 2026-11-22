/**
 * Slice 42, ADR 0017: the organizer page as HTML Google and AI assistants can read, one URL per language.
 *
 * Everything here comes from the shared route table and catalog in `@atlas/contract` plus PUBLIC_ORIGIN: nothing is read
 * from the request (language included), so the response depends on the path alone (S5). Tags are constants; every catalog
 * string reaches the HTML as text (escaped by the rewriter) or through jsonLdScript (S1, S3).
 */
import {
  ORGANIZER_FORM_ID,
  ORGANIZER_PAGE_STRINGS,
  ORGANIZER_ROUTES,
  ORGANIZER_X_DEFAULT_LANG,
  organizerPathForLang,
  type OrganizerLang,
  type OrganizerPageKey,
  type OrganizerRoute,
} from "@atlas/contract";
import { jsonLdScript } from "./event-page";

export const ORGANIZER_OG_IMAGE_PATH = "/organizers/og.jpg";

const attr = (v: string) => v.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export interface OrganizerPage {
  lang: OrganizerLang;
  title: string;
  description: string;
  imageAlt: string;
  canonical: string;
  imageUrl: string;
  noindex: boolean;
  /** Constant markup only (origin and paths from config and the route table). Empty for non-indexable routes. */
  hreflangLinks: string;
  /** Null for non-indexable routes. */
  jsonLd: Record<string, unknown> | null;
  faq: [string, string][];
  /** Text nodes and fixed tags in order, for `#root`. */
  body: Array<{ html: string } | { text: string }>;
}

export function buildOrganizerPage(route: OrganizerRoute, origin: string): OrganizerPage {
  const s = ORGANIZER_PAGE_STRINGS[route.lang];
  const t = (k: OrganizerPageKey) => s[k];
  const canonical = `${origin}${route.path}`;
  const faq: [string, string][] = [1, 2, 3, 4, 5].map((n) => [t(`orgFaq${n}Q` as OrganizerPageKey), t(`orgFaq${n}A` as OrganizerPageKey)]);

  let hreflangLinks = "";
  if (route.indexable) {
    const links: { hreflang: string; href: string }[] = ORGANIZER_ROUTES.filter((r) => r.indexable).map((r) => ({ hreflang: r.lang, href: `${origin}${r.path}` }));
    links.push({ hreflang: "x-default", href: `${origin}${organizerPathForLang(ORGANIZER_X_DEFAULT_LANG)}` });
    hreflangLinks = links.map((l) => `<link rel="alternate" hreflang="${l.hreflang}" href="${attr(l.href)}">`).join("");
  }

  const jsonLd = route.indexable
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
      }
    : null;

  const body: Array<{ html: string } | { text: string }> = [];
  const tag = (html: string) => body.push({ html });
  const txt = (text: string) => body.push({ text });
  const el = (open: string, text: string, close: string) => {
    tag(open);
    txt(text);
    tag(close);
  };
  tag('<main class="ssr-event">');
  el("<h1>", t("orgH1"), "</h1>");
  el("<p>", t("orgTagline"), "</p>");
  el("<p>", t("orgLead"), "</p>");
  tag(`<p><a href="#${ORGANIZER_FORM_ID}">`);
  txt(t("orgCta"));
  tag("</a></p>");
  el("<h2>", t("orgStepsH"), "</h2>");
  tag("<ol>");
  for (const n of [1, 2, 3]) {
    tag("<li>");
    el("<h3>", t(`orgStep${n}T` as OrganizerPageKey), "</h3>");
    el("<p>", t(`orgStep${n}P` as OrganizerPageKey), "</p>");
    tag("</li>");
  }
  tag("</ol>");
  el("<h2>", t("orgBenH"), "</h2>");
  tag("<ul>");
  for (const n of [1, 2, 3, 4]) {
    tag("<li>");
    el("<h3>", t(`orgBen${n}T` as OrganizerPageKey), "</h3>");
    el("<p>", t(`orgBen${n}P` as OrganizerPageKey), "</p>");
    tag("</li>");
  }
  tag("</ul>");
  el("<h2>", t("orgUcH"), "</h2>");
  for (const n of [1, 2, 3, 4, 5, 6]) {
    tag("<section>");
    el("<h3>", t(`orgUc${n}T` as OrganizerPageKey), "</h3>");
    tag("<ul>");
    for (const j of [1, 2, 3, 4]) el("<li>", t(`orgUc${n}P${j}` as OrganizerPageKey), "</li>");
    tag("</ul></section>");
  }
  el("<h2>", t("orgFaqH"), "</h2>");
  for (const [q, a] of faq) {
    el("<h3>", q, "</h3>");
    el("<p>", a, "</p>");
  }
  el("<p>", t("orgFree"), "</p>");
  tag("</main>");

  return {
    lang: route.lang,
    title: t("orgDocTitle"),
    description: t("orgMetaDesc"),
    imageAlt: t("orgImageAlt"),
    canonical,
    imageUrl: `${origin}${ORGANIZER_OG_IMAGE_PATH}`,
    noindex: !route.indexable,
    hreflangLinks,
    jsonLd,
    faq,
    body,
  };
}

/** Head extras as one fixed-structure string (canonical is added separately by the caller). */
export function organizerHeadExtras(page: OrganizerPage): string {
  return `${page.hreflangLinks}${page.noindex ? '<meta name="robots" content="noindex">' : ""}${page.jsonLd ? jsonLdScript(page.jsonLd) : ""}`;
}
