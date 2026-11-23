import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { PanelEvent } from "@atlas/contract";
import { useI18n } from "../../../i18n/I18nProvider";
import { LANG_NAMES } from "../../../i18n/messages";
import { BADGE_H, BADGE_W, canvasToPng, drawBadge, loadKitFonts } from "../../../lib/shareKit/badge";
import { KIT_LANGS, isKitLang, kitTextKey, toKitLang, type KitLang } from "../../../lib/shareKit/copy";
import { copyText, downloadBlob } from "../../../lib/shareKit/download";
import { buildEventUrl, kitFilename, makeQr, qrSvgMarkup } from "../../../lib/shareKit/qr";
import ShareDialog from "../../../components/ShareDialog";
import { Ic } from "./common";
import "./shareKit.css";

const FlyerDialog = lazy(() => import("./FlyerDialog"));

/**
 * "Compartir tu mapa" (slice 28): link, QR badge PNG, QR SVG and an A4 flyer. Everything is generated in the browser
 * from the validated slug. Published events only.
 */
export default function ShareKit({ event }: { event: PanelEvent }) {
  if (event.status !== "published") return null;
  return <Kit event={event} />;
}

function Kit({ event }: { event: PanelEvent }) {
  const { t, lang: panelLang } = useI18n();
  const [lang, setLang] = useState<KitLang>(() => toKitLang(panelLang));
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const [error, setError] = useState(false);
  const [flyer, setFlyer] = useState(false);
  const [sharing, setSharing] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<number>(0);

  // The only encoded text: public origin + "/e/" + validated slug.
  const url = useMemo(() => buildEventUrl(event.slug), [event.slug]);
  const qr = useMemo(() => makeQr(url), [url]);
  const textKey = kitTextKey(lang, event.country);
  const badge = { name: event.name, startDate: event.startDate, endDate: event.endDate, city: event.city, qr, lang, textKey };
  const key = JSON.stringify([event.name, event.startDate, event.endDate, event.city, url, lang, textKey]);

  // Preview = the same canvas that is exported, drawn after the bundled fonts are ready.
  useEffect(() => {
    let live = true;
    void loadKitFonts(`${event.name} ${event.city} leyenda ink 0123456789`).then(() => {
      if (live && canvas.current) drawBadge(canvas.current, badge);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    const ok = await copyText(url);
    if (!ok) {
      input.current?.focus();
      input.current?.select();
    }
    setCopied(ok ? "ok" : "fail");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), ok ? 2500 : 6000);
  };

  const downloadPng = async () => {
    setError(false);
    const c = document.createElement("canvas");
    await loadKitFonts(`${event.name} ${event.city} leyenda ink 0123456789`);
    const blob = drawBadge(c, badge) ? await canvasToPng(c) : null;
    if (!blob) return setError(true);
    downloadBlob(blob, kitFilename(event.slug, "badge"));
  };

  const downloadSvg = () => downloadBlob(new Blob([qrSvgMarkup(qr)], { type: "image/svg+xml" }), kitFilename(event.slug, "qr"));

  return (
    <section className="pe-hcardw pe-hshare" aria-labelledby={`${event.id}-share`}>
      <h2 className="pe-ctitle" id={`${event.id}-share`}><Ic n="share" size={16} />{t("skTitle")}</h2>
      <p className="pe-sub">{t("skLead")}</p>

      <div className="sk-linkrow">
        <input
          ref={input}
          className="pe-inp"
          type="text"
          readOnly
          value={url}
          dir="ltr"
          aria-label={t("skLinkLabel")}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" className="btn primary" onClick={() => void copy()}>
          <Ic n={copied === "ok" ? "check" : "copy"} size={18} />
          {copied === "ok" ? t("skCopied") : t("skCopy")}
        </button>
      </div>
      <div className="sk-linkrow2">
        <button type="button" className="btn" onClick={() => setSharing(true)}>{t("pePubShare")}</button>
        <a className="btn" href={`/e/${event.slug}`} target="_blank" rel="noopener noreferrer" aria-label={t("pePubOpenLabel")}>{t("pePubOpen")}</a>
      </div>
      <p className={`sk-note${copied === "fail" ? " bad" : ""}`} role="status">
        {copied === "ok" ? t("skCopiedSr") : copied === "fail" ? t("skCopyFail") : ""}
      </p>

      <div className="sk-kit">
        <canvas
          ref={canvas}
          className="sk-thumb"
          width={BADGE_W}
          height={BADGE_H}
          role="img"
          aria-label={t("skPreviewAlt")}
        />
        <div className="sk-side">
          <label className="sk-lang">
            <span>{t("skLang")}</span>
            <select className="pe-inp" value={lang} onChange={(e) => isKitLang(e.target.value) && setLang(e.target.value)}>
              {KIT_LANGS.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
            </select>
          </label>
          <div className="sk-btns">
            <button type="button" className="btn" onClick={() => void downloadPng()}>
              <Ic n="download" size={18} />{t("skPng")} <small>PNG</small>
            </button>
            <button type="button" className="btn" onClick={() => setFlyer(true)}>
              <Ic n="print" size={18} />{t("skFlyer")}
            </button>
            <button type="button" className="sk-link" onClick={downloadSvg}>{t("skSvg")}</button>
          </div>
          {error && <p className="sk-note bad" role="alert">{t("skPngFail")}</p>}
        </div>
      </div>

      {sharing && <ShareDialog slug={event.slug} eventName={event.name} onClose={() => setSharing(false)} />}
      {flyer && (
        <Suspense fallback={null}>
          <FlyerDialog
            slug={event.slug}
            flyer={{ name: event.name, startDate: event.startDate, endDate: event.endDate, city: event.city, qr, url, lang, textKey }}
            onClose={() => setFlyer(false)}
          />
        </Suspense>
      )}
    </section>
  );
}
