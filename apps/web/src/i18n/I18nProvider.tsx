import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { initialLang, isLang, storeLang } from "./detect";
import { MESSAGES, type Lang, type MessageKey } from "./messages";

type Ctx = {
  lang: Lang;
  setLang: (l: string) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
};
const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => initial ?? initialLang());

  useEffect(() => {
    document.documentElement.lang = lang; // allowlisted value, never user text
  }, [lang]);

  const setLang = useCallback((l: string) => {
    if (!isLang(l)) return;
    setLangState(l);
    storeLang(l);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => {
        let s: string = MESSAGES[lang][key] ?? MESSAGES.es[key] ?? key;
        if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
        return s;
      },
    }),
    [lang, setLang],
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
