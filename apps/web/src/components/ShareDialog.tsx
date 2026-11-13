import { useEffect, useRef, useState } from "react";
import { slugSchema } from "@atlas/contract";
import QrCode from "./QrCode";
import { useI18n } from "../i18n/I18nProvider";

/** The shareable link is built from the origin and the validated slug, never from location.href. */
export function buildShareUrl(slug: string, origin: string = window.location.origin) {
  return `${origin}/e/${slugSchema.parse(slug)}`;
}

export default function ShareDialog({ slug, eventName, onClose }: { slug: string; eventName: string; onClose: () => void }) {
  const { t } = useI18n();
  const url = buildShareUrl(slug);
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    opener.current = document.activeElement;
    dialog.current?.focus();
    return () => (opener.current as HTMLElement | null)?.focus?.();
  }, []);

  // Keep Tab inside the dialog and close on Escape.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab") {
      const f = dialog.current!.querySelectorAll<HTMLElement>("button, input, a[href]");
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = dialog.current?.querySelector<HTMLInputElement>("input");
      input?.select();
      document.execCommand?.("copy");
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title" tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="modal-head">
          <h2 id="share-title">{t("shareTitle")}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t("close")}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <p className="muted">{eventName}</p>
        <QrCode text={url} label={t("qrLabel")} />
        <p className="muted small center">{t("qrCaption")}</p>
        <label className="field-label" htmlFor="share-link">{t("shareLink")}</label>
        <div className="link-row">
          <input id="share-link" type="text" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn primary" onClick={copy}>
            {copied ? t("copied") : t("copyLink")}
          </button>
        </div>
        <span className="sr-only" role="status">{copied ? t("copied") : ""}</span>
        {canShare && (
          <button
            type="button"
            className="btn"
            onClick={() => navigator.share({ title: eventName, url }).catch(() => {})}
          >
            {t("nativeShare")}
          </button>
        )}
      </div>
    </div>
  );
}
