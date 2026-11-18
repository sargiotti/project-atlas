import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../../i18n/I18nProvider";
import { Ic } from "./common";
import { DEFAULT_FLYER, FLYER_TEMPLATES, type FlyerProps } from "./flyers";
import "./shareKit.css";

/**
 * Client-only A4 flyer: a modal rendered into <body>. window.print() prints just the sheet (print CSS hides the
 * app root), so "Save as PDF" works. No external resources, nothing leaves the browser.
 */
export default function FlyerDialog({ slug, flyer, onClose, template = DEFAULT_FLYER }: { slug: string; flyer: FlyerProps; onClose: () => void; template?: string }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const Template = FLYER_TEMPLATES[template] ?? FLYER_TEMPLATES[DEFAULT_FLYER];

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const title = document.title;
    document.title = `${slug}-cartel`; // suggested file name for "Save as PDF"
    document.body.classList.add("sk-printing");
    box.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !box.current) return;
      const f = [...box.current.querySelectorAll<HTMLElement>("button:not(:disabled)")];
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
      document.body.classList.remove("sk-printing");
      document.title = title;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [slug]);

  return createPortal(
    <div className="app pe sk-host" data-theme="auto">
    <div className="sk-ovl" onMouseDown={(e) => e.target === e.currentTarget && close.current()}>
      <div ref={box} className="sk-fdlg" role="dialog" aria-modal="true" aria-labelledby="sk-ftitle">
        <div className="sk-chrome">
          <h2 id="sk-ftitle">{t("skFlyerTitle")}</h2>
          <div className="sk-chrome-acts">
            <button type="button" className="btn primary" onClick={() => window.print()}><Ic n="print" size={18} />{t("skPrint")}</button>
            <button type="button" className="btn" onClick={onClose}>{t("close")}</button>
          </div>
          <p className="pe-sub">{t("skPrintHint")}</p>
        </div>
        <div className="sk-fit">
          <div className="sk-sheet"><Template {...flyer} /></div>
        </div>
      </div>
    </div>
    </div>,
    document.body,
  );
}
