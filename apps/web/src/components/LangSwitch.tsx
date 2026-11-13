import { LANGS, LANG_NAMES } from "../i18n/messages";
import type { Lang } from "../i18n/messages";
import { useI18n } from "../i18n/I18nProvider";

/**
 * Compact language selector. A native <select> (best a11y and native picker on phones) sits invisibly
 * over a small "globe + code + chevron" face. Values come from the allowlist only.
 */
export default function LangSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <label className="lang-select">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
      </svg>
      <span className="lang-code" aria-hidden="true">{lang.toUpperCase()}</span>
      <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" className="chev">
        <path d="M6 9l6 6 6-6" />
      </svg>
      <select aria-label={t("language")} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
        {LANGS.map((l) => (
          <option key={l} value={l} lang={l}>{LANG_NAMES[l]}</option>
        ))}
      </select>
    </label>
  );
}
