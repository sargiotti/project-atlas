import { useEffect, useRef, useState } from "react";
import { MarkerToken, type MapTheme } from "../../../../markers/Pixel";
import { useI18n } from "../../../../i18n/I18nProvider";
import { JUST_DROP, MAX_POINTS, NAME_IT } from "../../../../lib/pointsModel";
import { Ic } from "../common";

const SLOP = 5;

type Props = {
  theme: MapTheme;
  armed: string | null;
  onArm: (category: string | null) => void;
  /** A piece was dropped on the map by dragging. x / y are 0..1. */
  onDrop: (category: string, x: number, y: number) => void;
  /** The transformed map stage, to tell whether a release landed on the map. */
  stageRef: React.RefObject<HTMLDivElement | null>;
  count: number;
  /** Onboarding: the piece that bounces right now. */
  nudge?: string | null;
};

type Drag = { category: string; x: number; y: number; over: boolean };

/**
 * The palette (left rail, first tab). A piece is dragged with Pointer Events (custom ghost, works with touch) or armed
 * with a click and then placed with a click on the map (WCAG 2.5.7: a single-pointer alternative to dragging).
 */
export default function Palette({ theme, armed, onArm, onDrop, stageRef, count, nudge }: Props) {
  const { t } = useI18n();
  const full = count >= MAX_POINTS;
  const start = useRef<{ id: number; x: number; y: number; category: string } | null>(null);
  const swallow = useRef(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragging = useRef(false);

  const hit = (cx: number, cy: number) => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r || !r.width) return null;
    const x = (cx - r.left) / r.width;
    const y = (cy - r.top) / r.height;
    return { x, y, inside: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
  };

  const cancel = () => {
    start.current = null;
    dragging.current = false;
    setDrag(null);
  };

  // Esc while dragging cancels the drop.
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        swallow.current = true;
        cancel();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [!!drag]); // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e: React.PointerEvent<HTMLButtonElement>, category: string) => {
    if (e.button !== 0 || full) return;
    start.current = { id: e.pointerId, x: e.clientX, y: e.clientY, category };
  };
  const move = (e: React.PointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    if (!dragging.current) {
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < SLOP) return;
      dragging.current = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      onArm(null);
    }
    setDrag({ category: s.category, x: e.clientX, y: e.clientY, over: !!hit(e.clientX, e.clientY)?.inside });
  };
  const up = (e: React.PointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const wasDragging = dragging.current;
    const h = wasDragging ? hit(e.clientX, e.clientY) : null;
    cancel();
    if (!wasDragging) return; // a plain click: the click handler arms the piece
    swallow.current = true;
    if (h?.inside) onDrop(s.category, h.x, h.y);
  };

  const piece = (category: string, named: boolean) => (
    <button
      key={category}
      type="button"
      className={`ped-piece${armed === category ? " armed" : ""}${nudge === category ? " nudge" : ""}`}
      aria-pressed={armed === category}
      disabled={full}
      title={full ? t("pedLimit") : t("pedPieceTip")}
      data-category={category}
      onPointerDown={(e) => down(e, category)}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onClick={() => {
        if (swallow.current) {
          swallow.current = false;
          return;
        }
        onArm(armed === category ? null : category);
      }}
    >
      {named && <span className="pen" aria-hidden="true"><Ic n="pencil" size={14} /></span>}
      <span className="tok"><MarkerToken category={category} theme={theme} /></span>
      <span className="lbl">{t(`cat_${category}` as any)}</span>
    </button>
  );

  return (
    <>
      <h3 className="ped-gh"><Ic n="pencil" size={14} />{t("pedGroupName")}</h3>
      <p className="ped-gsub">{t("pedGroupNameSub")}</p>
      <div className="ped-pieces">{NAME_IT.map((c) => piece(c, true))}</div>
      <h3 className="ped-gh">{t("pedGroupDrop")}</h3>
      <p className="ped-gsub">{t("pedGroupDropSub")}</p>
      <div className="ped-pieces">{JUST_DROP.map((c) => piece(c, false))}</div>
      {drag && (
        <div className={`ped-ghost${drag.over ? "" : " no"}`} style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          <span className="target" />
          <span className="lift"><MarkerToken category={drag.category} theme={theme} /></span>
          <span className="gl">{drag.over ? t("pedGhostOk") : t("pedGhostNo")}</span>
        </div>
      )}
    </>
  );
}
