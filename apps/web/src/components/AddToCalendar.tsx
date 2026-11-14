import { useEffect, useId, useRef, useState } from "react";
import { downloadIcs, googleCalendarUrl, type CalendarInput } from "../lib/calendar";
import { useI18n } from "../i18n/I18nProvider";

const calIcon = (
  <svg className="ln" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <rect x="4" y="5" width="16" height="15" rx="2" />
    <path d="M4 10h16M9 3v4M15 3v4M12 13v5M9.5 15.5h5" />
  </svg>
);
const chevIcon = (
  <svg className="ln" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/**
 * "Add to calendar" menu: Google Calendar is a plain link (new tab, noopener noreferrer); Apple / Outlook builds an
 * .ics in the browser. Opening the menu makes no request and loads nothing.
 */
export default function AddToCalendar({ input, variant }: { input: CalendarInput; variant: "primary" | "icon" }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const label = `${t("calAdd")}: ${input.session.title}`;

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
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

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.stopPropagation(); // do not close the whole sheet
      close(true);
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
      const i = items.indexOf(document.activeElement as HTMLElement);
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
  };

  return (
    <div className={"menuwrap " + variant} ref={wrap} onKeyDown={onKeyDown}>
      {open && (
        <div className="menu" role="menu" id={menuId} aria-label={t("calMenu")}>
          <a role="menuitem" href={googleCalendarUrl(input)} target="_blank" rel="noopener noreferrer" onClick={() => close(false)}>
            <svg className="ln" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" />
            </svg>
            <span>
              {t("calGoogle")}
              <small>{t("calGoogleSub")}</small>
            </span>
          </a>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              downloadIcs(input);
              close(true);
            }}
          >
            <svg className="ln" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
            </svg>
            <span>
              {t("calIcs")}
              <small>{t("calIcsSub")}</small>
            </span>
          </button>
        </div>
      )}
      <button
        ref={trigger}
        type="button"
        className={variant === "primary" ? "btn primary cal-btn" : "cal-icon-btn"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={variant === "icon" ? label : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {calIcon}
        {variant === "primary" && (
          <>
            {t("calAdd")}
            {chevIcon}
          </>
        )}
      </button>
    </div>
  );
}
