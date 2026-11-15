import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import { Link } from "../../../lib/router";
import "./events.css";
import "./publish.css";

// ---- icons (same stroke set as the design deliverable) ----------------------------------------------
const PATHS = {
  plus: <path d="M12 5v14M5 12h14" />,
  left: <path d="M15 6l-6 6 6 6" />,
  chev: <path d="M6 9l6 6 6-6" />,
  globe: (<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>),
  pencil: <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  eye: (<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  info: (<><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>),
  pin: (<><path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></>),
  cal: (<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>),
  lock: (<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>),
  search: (<><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  share: <path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  warn: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></>),
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  map: <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />,
  upload: <path d="M12 15V4M7 9l5-5 5 5M4 15v5h16v-5" />,
  swap: <path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4" />,
  tri: (<><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.5" /></>),
  tent: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  food: <path d="M5 3v8a3 3 0 0 0 6 0V3M8 3v18M17 3c-2 2-2 6 0 8v10" />,
  redo: (<><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></>),
  undo: (<><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>),
};
export type IconName = keyof typeof PATHS;
export function Ic({ n, size = 20 }: { n: IconName; size?: number }) {
  return (
    <svg className="pe-ic" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      {PATHS[n]}
    </svg>
  );
}

// ---- per-event pastel: palette[hash(id) % 8], so it is stable without a DB field ---------------------
const PALETTE: [string, string][] = [
  ["#FBE7A6", "#4a4122"], ["#D7DCFA", "#2f3466"], ["#CDEDC4", "#28432c"], ["#FBD3B0", "#4d3424"],
  ["#FAD3E7", "#4a2a40"], ["#C6EEF2", "#21434a"], ["#FBD0CF", "#4d2a2e"], ["#EEEBC0", "#3f3f22"],
];
export function pastel(id: string): CSSProperties {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [pf, pfd] = PALETTE[h % 8];
  return { "--pf": pf, "--pfd": pfd } as CSSProperties;
}

// ---- dates ---------------------------------------------------------------------------------------------
const utc = (d: string) => new Date(`${d}T00:00:00Z`);
export function dayNumber(d: string) {
  return utc(d).getUTCDate();
}
export function monthShort(d: string, lang: string) {
  try {
    return new Intl.DateTimeFormat(lang, { timeZone: "UTC", month: "short" }).format(utc(d)).replace(".", "");
  } catch {
    return "";
  }
}
export function longDay(d: string, lang: string) {
  try {
    return new Intl.DateTimeFormat(lang, { timeZone: "UTC", day: "numeric", month: "long" }).format(utc(d));
  } catch {
    return d;
  }
}
export function dateRange(start: string, end: string, lang: string) {
  if (!start) return "";
  try {
    const f = new Intl.DateTimeFormat(lang, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
    return !end || start === end || end < start ? f.format(utc(start)) : f.formatRange(utc(start), utc(end));
  } catch {
    return start === end || !end ? start : `${start} – ${end}`;
  }
}

/** Date tile shown on cards: day number over a short month. */
export function DayTile({ start }: { start: string }) {
  const { lang } = useI18n();
  return (
    <span className="pe-dnum">
      {dayNumber(start)}
      <small>{monthShort(start, lang)}</small>
    </span>
  );
}

// ---- small hooks ---------------------------------------------------------------------------------------
/** document.title as plain text, restored on leave. */
export function useDocTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => {
      document.title = prev;
    };
  }, [title]);
}

// A one-shot message handed from one screen to the next ("Draft saved", "Event deleted"). Memory only.
let flash: { kind: "saved" | "changes" | "deleted" | "msg"; name?: string } | null = null;
export function setFlash(f: NonNullable<typeof flash>) {
  flash = f;
}
export function takeFlash() {
  const f = flash;
  flash = null;
  return f;
}

// ---- generic states ------------------------------------------------------------------------------------
export function PanelNotFound() {
  const { t } = useI18n();
  return (
    <div className="status-card">
      <h1>{t("pageNotFoundTitle")}</h1>
      <p>{t("pageNotFoundText")}</p>
      <Link to="/panel" className="btn primary">{t("myEvents")}</Link>
    </div>
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="status-card">
      <h1>{t("unavailableTitle")}</h1>
      <p>{t("peLoadError")}</p>
      <button type="button" className="btn primary" onClick={onRetry}>{t("retry")}</button>
    </div>
  );
}

export function Loading() {
  const { t } = useI18n();
  return <p className="loading" role="status">{t("peLoadingEvent")}</p>;
}

// ---- dialog: focus trap, Esc closes, focus returns to the opener -------------------------------------
export function Dialog({
  titleId,
  descId,
  initialFocus,
  onClose,
  hideEscHint,
  children,
}: {
  titleId: string;
  descId: string;
  initialFocus: () => HTMLElement | null;
  onClose: () => void;
  /** Dialogs that require an explicit choice do not close on Esc, so they do not advertise it. */
  hideEscHint?: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const init = useRef(initialFocus);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    init.current()?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !box.current) return;
      const f = [...box.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href]")];
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && (i === f.length - 1 || i === -1)) {
        e.preventDefault();
        f[0].focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  return (
    <div className="pe-ovl" onMouseDown={(e) => e.target === e.currentTarget && close.current()}>
      <div ref={box} className="pe-dlg" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId}>
        {children}
        {!hideEscHint && <p className="pe-kbhint"><kbd>Esc</kbd> {t("peKbClose")}</p>}
      </div>
    </div>
  );
}

/** Status toast ("Changes saved", "Event deleted"). Auto-dismisses. */
export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  const cb = useRef(onDone);
  cb.current = onDone;
  useEffect(() => {
    const id = setTimeout(() => cb.current(), 3600);
    return () => clearTimeout(id);
  }, []);
  return (
    <div className="pe-toast" role="status">
      <Ic n="check" size={18} />
      <span dir="auto">{text}</span>
    </div>
  );
}

export function useFlashToast() {
  const { t } = useI18n();
  const [toast, setToast] = useState<string | null>(null);
  const [banner, setBanner] = useState(false);
  useEffect(() => {
    const f = takeFlash();
    if (!f) return;
    if (f.kind === "saved") setBanner(true);
    else if (f.kind === "changes") setToast(t("peChangesSaved"));
    else if (f.kind === "msg") setToast(f.name ?? "");
    else if (f.kind === "deleted") setToast(t("peDeleted", { name: f.name ?? "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { toast, clearToast: () => setToast(null), banner };
}

// ---- publication status badge (slice 08b). The label for `rejected` is the organizer one: "Not approved". ------
export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const m: Record<string, [string, string]> = {
    draft: ["st-draft", t("peDraft")],
    in_review: ["st-review", t("peStReview")],
    published: ["st-pub", t("peStPublished")],
    rejected: ["st-rej", t("peStRejected")],
    unpublished_admin: ["st-unpub", t("peStUnpublished")],
  };
  const [cls, label] = m[status] ?? m.draft;
  return <span className={`st ${cls}`}>{label}</span>;
}
