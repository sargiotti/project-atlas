import { LANGS, LANG_NAMES } from "../i18n/messages";
import { useI18n } from "../i18n/I18nProvider";

/** Always-visible language selector (es / en / da). Values come from the allowlist only. */
export default function LangSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label={t("language")}>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          className={l === lang ? "on" : ""}
          aria-pressed={l === lang}
          aria-label={LANG_NAMES[l]}
          onClick={() => setLang(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
