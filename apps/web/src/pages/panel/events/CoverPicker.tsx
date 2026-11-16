import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import { drawCrop } from "../../../lib/coverImage";
import { CENTRE, RATIO, clampFocal, needsTrim, surfaceRect, type Focal, type Surface } from "../../../lib/coverRules";
import { Ic } from "./common";

type Pic = { width: number; height: number };
type Bitmap = Pic & CanvasImageSource;

/**
 * A local preview: the part of `bitmap` that a surface shows at the focal point. Drawn on a <canvas> from an ImageBitmap
 * (the SPA CSP blocks blob: images, and nothing is uploaded before the organizer saves).
 */
export function CropCanvas({ bitmap, ratio, focal, w = 480, className }: { bitmap: Bitmap; ratio: number; focal: Focal; w?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawCrop(ref.current, bitmap as any, ratio, focal);
  }, [bitmap, ratio, focal.x, focal.y]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className={className} width={w} height={Math.round(w / ratio)} aria-hidden="true" />;
}

const SURFACES: Surface[] = ["card", "og", "sheet"];
const FRAME_CLASS: Record<Surface, string> = { card: "f-card", og: "f-og", sheet: "f-sheet" };
const FRAME_LABEL = { card: "cvFrameCard", og: "cvFrameOg", sheet: "cvFrameSheet" } as const;
const PV_LABEL = { card: "cvPvCard", og: "cvPvOg", sheet: "cvPvSheet" } as const;
const QUICK = [0.15, 0.5, 0.85];

/**
 * Focal point picker (design 18): the picture with the three crop frames on it, one click (or arrow keys, or the 3x3 grid)
 * moves the point, live previews of the Home card, the WhatsApp preview and the About sheet beside it.
 * It only reports the point; saving is the parent's explicit action.
 */
export default function CoverPicker({
  bitmap, name, eventName, focal, onFocal, locked, locale,
}: { bitmap: Bitmap; name: string; eventName: string; focal: Focal; onFocal: (f: Focal) => void; locked?: boolean; locale?: string }) {
  const { t } = useI18n();
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hot, setHot] = useState<Surface | null>(null);
  const [live, setLive] = useState("");
  const down = useRef(false);
  const W = bitmap.width;
  const H = bitmap.height;
  const sw = Math.min(1000, W);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
    }
  }, [bitmap]);

  const set = (x: number, y: number) => {
    const f = clampFocal(x, y);
    onFocal(f);
    setLive(t("cvFocalLive", { x: Math.round(f.x * 100), y: Math.round(f.y * 100) }));
  };
  const at = (e: PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    if (r.width && r.height) set((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };
  const onKey = (e: KeyboardEvent) => {
    if (locked) return;
    const d = e.shiftKey ? 0.01 : 0.05;
    const m = ({ ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] } as Record<string, number[]>)[e.key];
    if (m) {
      e.preventDefault();
      set(focal.x + m[0]!, focal.y + m[1]!);
    } else if (e.key === "Home") {
      e.preventDefault();
      set(CENTRE.x, CENTRE.y);
    }
  };

  // Frames and the "kept by every crop" area, as fractions of the whole picture.
  const rects = SURFACES.map((s) => ({ s, r: surfaceRect(W, H, RATIO[s], focal) }));
  const inter = rects.reduce(
    (a, { r }) => ({ x0: Math.max(a.x0, r.sx), y0: Math.max(a.y0, r.sy), x1: Math.min(a.x1, r.sx + r.sw), y1: Math.min(a.y1, r.sy + r.sh) }),
    { x0: 0, y0: 0, x1: W, y1: H },
  );
  const hr = hot ? rects.find((x) => x.s === hot)!.r : null;
  const keep = hr ? { x0: hr.sx, y0: hr.sy, x1: hr.sx + hr.sw, y1: hr.sy + hr.sh } : inter;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const posName = (x: number, y: number) => t(`cvPos${y === 0.15 ? "T" : y === 0.5 ? "" : "B"}${x === 0.15 ? "L" : x === 0.5 ? "" : "R"}`.replace(/^cvPos$/, "cvPosM") as any);

  return (
    <div className="cv-pick">
      <div>
        <div
          ref={stage}
          className={`cv-stage${locked ? " locked" : ""}`}
          tabIndex={locked ? -1 : 0}
          role="group"
          aria-roledescription="focal point picker"
          aria-label={`${t("cvStageLabel")} ${t("cvStageAlt", { name })}`}
          aria-describedby="cv-tip"
          onKeyDown={onKey}
          onPointerDown={(e) => {
            if (locked) return;
            down.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            at(e);
          }}
          onPointerMove={(e) => down.current && !locked && at(e)}
          onPointerUp={() => (down.current = false)}
          onPointerCancel={() => (down.current = false)}
        >
          <canvas ref={canvas} width={sw} height={Math.max(1, Math.round((sw * H) / W))} aria-hidden="true" />
          <div className="cv-frames" aria-hidden="true">
            <div className="cv-keep" style={{ left: pct(keep.x0, W), top: pct(keep.y0, H), width: pct(keep.x1 - keep.x0, W), height: pct(keep.y1 - keep.y0, H) }} />
            {rects.map(({ s, r }) => (
              <div key={s} className={`cv-frame ${FRAME_CLASS[s]}${hot === s ? " hot" : ""}`} style={{ left: pct(r.sx, W), top: pct(r.sy, H), width: pct(r.sw, W), height: pct(r.sh, H) }}>
                <em>{t(FRAME_LABEL[s])}</em>
              </div>
            ))}
            <div className="cv-dot" style={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%` }} />
          </div>
        </div>
        <div className="cv-tools">
          <span className="qlbl" id="cv-q-l">{t("cvQuick")}</span>
          <div className="cv-q" role="group" aria-labelledby="cv-q-l">
            {QUICK.map((y) =>
              QUICK.map((x) => (
                <button
                  key={`${x},${y}`}
                  type="button"
                  aria-label={posName(x, y)}
                  aria-pressed={Math.abs(x - focal.x) < 0.01 && Math.abs(y - focal.y) < 0.01}
                  disabled={locked}
                  onClick={() => set(x, y)}
                />
              )),
            )}
          </div>
          <button type="button" className="btn sm ghost" disabled={locked} onClick={() => set(CENTRE.x, CENTRE.y)}>{t("cvCentre")}</button>
          <span className="cv-meta" dir="auto">{name} · {W} × {H} px</span>
        </div>
        <p className="cv-tip" id="cv-tip">
          <Ic n="info" size={16} />
          <span>{needsTrim(W, H) ? t("cvTipTall") : t("cvTip")}</span>
        </p>
        <p className="sr-only" role="status" aria-live="polite">{live}</p>
      </div>
      <div className="cv-pvs">
        {SURFACES.map((s) => (
          <div
            key={s}
            className="blk"
            onMouseEnter={() => setHot(s)}
            onMouseLeave={() => setHot(null)}
            onFocus={() => setHot(s)}
            onBlur={() => setHot(null)}
          >
            <h4><span className={`k ${FRAME_CLASS[s]}`} aria-hidden="true" />{t(PV_LABEL[s])}</h4>
            {s === "card" && (
              <div className="cv-pcard">
                <CropCanvas bitmap={bitmap} ratio={RATIO.card} focal={focal} w={400} />
                <div className="pb"><b dir="auto">{eventName}</b></div>
              </div>
            )}
            {s === "og" && (
              <div className="cv-wa" lang={locale}>
                <div className="og">
                  <CropCanvas bitmap={bitmap} ratio={RATIO.og} focal={focal} w={600} />
                  <img className="bdg" src="/cover-badge.png" alt="" />
                </div>
                <div className="pt"><b dir="auto">{eventName}</b></div>
              </div>
            )}
            {s === "sheet" && (
              <div className="cv-psheet"><CropCanvas bitmap={bitmap} ratio={RATIO.sheet} focal={focal} w={480} /></div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
