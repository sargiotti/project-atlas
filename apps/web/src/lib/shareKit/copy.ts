/** Static text of the badge and the flyer in the four supported languages. Only these strings are ever drawn besides event data. */
export const KIT_LANGS = ["es", "en", "ca", "da"] as const;
export type KitLang = (typeof KIT_LANGS)[number];

export const isKitLang = (v: unknown): v is KitLang => typeof v === "string" && (KIT_LANGS as readonly string[]).includes(v);
export const toKitLang = (v: unknown): KitLang => (isKitLang(v) ? v : "es");

/** Spanish for Argentina and Uruguay uses "vos" on the poster. A kit is never mixed: one text variant per piece. */
export type KitTextKey = KitLang | "es-vos";
export const VOS_COUNTRIES = ["AR", "UY"];
export const kitTextKey = (lang: KitLang, country?: string | null): KitTextKey =>
  lang === "es" && !!country && VOS_COUNTRIES.includes(country.toUpperCase()) ? "es-vos" : lang;

export const KIT_TEXT: Record<KitTextKey, { badgeCta: string; flyerCta: string; flyerSub: string }> = {
  es: { badgeCta: "Escanea para ver el mapa", flyerCta: "Escanea para ver *el mapa* y los horarios", flyerSub: "Se abre en el navegador. Sin descargar nada." },
  "es-vos": { badgeCta: "Escaneá para ver el mapa", flyerCta: "Escaneá para ver *el mapa* y los horarios", flyerSub: "Se abre en el navegador. Sin descargar nada." },
  en: { badgeCta: "Scan to see the map", flyerCta: "Scan to see the *map* and the schedule", flyerSub: "Opens in your browser. Nothing to download." },
  ca: { badgeCta: "Escaneja per veure el mapa", flyerCta: "Escaneja per veure *el mapa* i els horaris", flyerSub: "S’obre al navegador. Sense baixar res." },
  da: { badgeCta: "Scan for at se kortet", flyerCta: "Scan for at se *kortet* og programmet", flyerSub: "Åbner i din browser. Ingen download." },
};

const utc = (d: string) => new Date(`${d}T00:00:00Z`);

/** "4–7 dic" (badge) or "4–7 de diciembre" (flyer), in the chosen language. Falls back to the ISO dates. */
export function kitDates(start: string, end: string, lang: KitLang, style: "short" | "long"): string {
  try {
    const f = new Intl.DateTimeFormat(lang, { timeZone: "UTC", day: "numeric", month: style });
    return !end || end <= start ? f.format(utc(start)) : f.formatRange(utc(start), utc(end));
  } catch {
    return !end || end <= start ? start : `${start} – ${end}`;
  }
}

export const kitMeta = (e: { startDate: string; endDate: string; city: string }, lang: KitLang, style: "short" | "long") =>
  `${kitDates(e.startDate, e.endDate, lang, style)} · ${e.city}`;

/** Splits "Scan to see the *map*" into plain and emphasised parts. */
export function splitEmphasis(s: string): { text: string; em: boolean }[] {
  return s.split("*").map((text, i) => ({ text, em: i % 2 === 1 })).filter((p) => p.text);
}
