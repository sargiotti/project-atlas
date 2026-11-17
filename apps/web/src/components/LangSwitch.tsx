import { useEffect, useId, useRef, useState } from "react";
import { LANG_NAMES } from "../i18n/messages";
import type { Lang } from "../i18n/messages";
import { isLang } from "../i18n/detect";
import { useI18n } from "../i18n/I18nProvider";
import Flag from "./Flag";

// A to Z by endonym. LANGS keeps its own order (detection and fallbacks).
export const SWITCHER_ORDER: Lang[] = ["ca", "da", "en", "es"];

const chev = (
  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false" className="ln chev">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/**
 * Compact language menu: flag + code + chevron opens a list of flag + endonym rows (menuitemradio).
 * Same keyboard pattern as AddToCalendar. Values are checked against the allowlist before setLang.
 */
export default function LangSwitch() {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const items = wrap.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    (wrap.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? items?.[0])?.focus();
    const away = (e: Event) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const pick = (value: string) => {
    if (isLang(value)) setLang(value);
    close(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  };

  return (
    <div className="menuwrap lang-wrap" ref={wrap} onKeyDown={onKeyDown}>
      {open && (
        <div className="menu lang-menu" role="menu" id={menuId} aria-label={t("language")}>
          {SWITCHER_ORDER.map((l) => (
            <button key={l} type="button" role="menuitemradio" aria-checked={l === lang} lang={l} onClick={() => pick(l)}>
              <Flag lang={l} />
              <span className="lang-name">{LANG_NAMES[l]}</span>
              {l === lang && (
                <svg className="ln lang-check" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
      <button
        ref={trigger}
        type="button"
        className="lang-btn"
        aria-label={`${t("language")}: ${LANG_NAMES[lang]}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Flag lang={lang} />
        <span className="lang-code" aria-hidden="true">{lang.toUpperCase()}</span>
        {chev}
      </button>
    </div>
  );
}
