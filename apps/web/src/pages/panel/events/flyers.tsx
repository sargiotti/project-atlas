import type { CSSProperties, ReactElement } from "react";
import QrSvg from "../../../components/QrSvg";
import { KIT_TEXT, kitMeta, splitEmphasis, type KitLang, type KitTextKey } from "../../../lib/shareKit/copy";
import { INK, PIN_BODY, PIN_WINDOW, TANGERINE, type Qr } from "../../../lib/shareKit/qr";

export type FlyerProps = {
  name: string;
  startDate: string;
  endDate: string;
  city: string;
  qr: Qr;
  url: string;
  lang: KitLang;
  textKey?: KitTextKey;
};

function Wordmark() {
  return (
    <span className="fl-wm" role="img" aria-label="leyenda.ink">
      leyenda
      <svg viewBox="0 0 80 80" aria-hidden="true" shapeRendering="crispEdges">
        <g fill={TANGERINE}>{PIN_BODY.map(([x, y, w, h]) => <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} />)}</g>
        <rect x={PIN_WINDOW[0]} y={PIN_WINDOW[1]} width={PIN_WINDOW[2]} height={PIN_WINDOW[3]} fill={INK} />
      </svg>
      ink
    </span>
  );
}

/** Name size in mm: 21 -> 14 by length, at most 2 lines (the rest is clamped with an ellipsis in CSS). */
export const nameMm = (name: string) => (name.length <= 30 ? 21 : name.length <= 42 ? 17 : 14);

/** Option 2A: big QR. Every length is in mm (--mm), so the same markup previews on screen and prints at A4. */
function FlyerA({ name, startDate, endDate, city, qr, url, lang, textKey }: FlyerProps) {
  const txt = KIT_TEXT[textKey ?? lang];
  return (
    <div className="fl fl-a">
      <h3 className="fl-name" dir="auto" style={{ "--fs": nameMm(name) } as CSSProperties}>{name}</h3>
      <p className="fl-meta" dir="auto">{kitMeta({ startDate, endDate, city }, lang, "long")}</p>
      <div className="fl-qr"><QrSvg qr={qr} label={url} /></div>
      <p className="fl-cta">{splitEmphasis(txt.flyerCta).map((p, i) => (p.em ? <u key={i}>{p.text}</u> : <span key={i}>{p.text}</span>))}</p>
      <p className="fl-sub">{txt.flyerSub}</p>
      <div className="fl-foot">
        <span className="fl-url">{url.replace(/^https?:\/\//, "")}</span>
        <Wordmark />
      </div>
    </div>
  );
}

/** Slice 28b adds 2B and 2C here; the dialog and the card only know this registry. */
export const FLYER_TEMPLATES: Record<string, (p: FlyerProps) => ReactElement> = { "2A": FlyerA };
export const DEFAULT_FLYER = "2A";
