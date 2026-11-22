import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { initialLang, isLang, loadStoredLang, storeLang } from "./detect";
import { fetchGeoLang, knownGeoLang, shouldAskGeo } from "./geoLang";
import { MESSAGES, type Lang, type MessageKey } from "./messages";
import { ES_VOS } from "./organizerMessages";
import { prefersVos } from "./detect";
import { organizerPathForLang, organizerRouteForPath } from "@atlas/contract";
import { navigate, usePath } from "../lib/router";

type Ctx = {
  lang: Lang;
  /** Rioplatense variant active (only meaningful when lang is es). */
  vos: boolean;
  setLang: (l: string) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
};
const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children, initial, vos }: { children: ReactNode; initial?: Lang; vos?: boolean }) {
  // Spanish variant (slice 30): base es is "tú"; es-AR / es-UY browsers get the vos overrides. One "Español" in the selector.
  const [isVos] = useState(() => vos ?? prefersVos());
  // Precedence: stored manual choice > Catalonia geo default (slice 21b) > browser language > Spanish.
  // The geo answer lives in memory only; just an explicit pick (setLang) writes atlas.lang.
  const [askGeo] = useState(() => loadStoredLang() === null && shouldAskGeo());
  const [storedLang, setLangState] = useState<Lang>(() => (askGeo ? knownGeoLang() : null) ?? initial ?? initialLang());
  const picked = useRef(false);
  // Slice 42 (ADR 0017): on the four organizer URLs the URL decides the language (fixed route table, exact paths).
  // Nothing is stored by landing there; leaving the page falls back to the usual precedence below.
  const routeLang = organizerRouteForPath(usePath())?.lang ?? null;
  const lang: Lang = routeLang ?? storedLang;

  useEffect(() => {
    if (!askGeo) return;
    let live = true;
    fetchGeoLang().then((g) => {
      if (live && g && !picked.current) setLangState(g);
    });
    return () => {
      live = false;
    };
  }, [askGeo]);

  useEffect(() => {
    document.documentElement.lang = lang; // allowlisted value, never user text
  }, [lang]);

  const setLang = useCallback((l: string) => {
    if (!isLang(l)) return;
    picked.current = true;
    setLangState(l);
    storeLang(l);
    // On the organizer page the flags move to that language's URL (constant paths from the route table).
    if (organizerRouteForPath(window.location.pathname)) navigate(organizerPathForLang(l as any));
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      lang,
      vos: lang === "es" && isVos,
      setLang,
      t: (key, vars) => {
        let s: string = (lang === "es" && isVos ? (ES_VOS as Record<string, string>)[key] : undefined) ?? MESSAGES[lang][key] ?? MESSAGES.es[key] ?? key;
        if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
        return s;
      },
    }),
    [lang, setLang, isVos],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}

/** "3 points" / "1 point" using the UI language's plural rule. */
export function useCount() {
  const { lang, t } = useI18n();
  return (n: number) =>
    t(new Intl.PluralRules(lang).select(n) === "one" ? "pointsCount_one" : "pointsCount_other", { n });
}
