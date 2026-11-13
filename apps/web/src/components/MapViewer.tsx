import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Point } from "@atlas/contract";
import { MarkerToken, QuestArrow, TOKEN_SIZE, type MapTheme } from "../markers/Pixel";
import { useI18n } from "../i18n/I18nProvider";

// Space taken by the floating top bar and the Map/List switch (design deliverable 02).
const SAFE_TOP = 82;
const SAFE_BOTTOM = 80;
const SIDE_MARGIN = 12;
const MAX_ZOOM_OVER_FIT = 8;
const TAP_SLOP = 6;

type View = { x: number; y: number; k: number };
type Size = { w: number; h: number };

type Props = {
  imageUrl: string;
  width: number;
  height: number;
  points: Point[];
  theme: MapTheme;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Ask the map to centre on a point; a new nonce re-triggers it. */
  focusRequest: { id: string; nonce: number } | null;
  categoryLabel: (category: string) => string;
};

export default function MapViewer({ imageUrl, width: W, height: H, points, theme, selectedId, onSelect, focusRequest, categoryLabel }: Props) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [view, setViewState] = useState<View>({ x: 0, y: 0, k: 1 });
  const [animate, setAnimate] = useState(false);
  const [imgState, setImgState] = useState<"loading" | "ok" | "error">("loading");
  const viewRef = useRef(view);
  const touched = useRef(false);
  const animTimer = useRef<number | undefined>(undefined);

  // ---- geometry -------------------------------------------------------------------------
  const availW = Math.max(1, size.w - SIDE_MARGIN * 2);
  const availH = Math.max(1, size.h - SAFE_TOP - SAFE_BOTTOM);
  const fitK = size.w ? Math.min(availW / W, availH / H) : 1;
  const minK = fitK * 0.75;
  const maxK = Math.max(fitK * MAX_ZOOM_OVER_FIT, 1.5);

  const clamp = useCallback(
    (v: View): View => {
      const k = Math.min(maxK, Math.max(minK, v.k));
      const sw = W * k;
      const sh = H * k;
      let x = v.x;
      let y = v.y;
      if (sw <= availW) x = (size.w - sw) / 2;
      else x = Math.min(SIDE_MARGIN, Math.max(size.w - sw - SIDE_MARGIN, x));
      if (sh <= availH) y = SAFE_TOP + (availH - sh) / 2;
      else y = Math.min(SAFE_TOP, Math.max(size.h - SAFE_BOTTOM - sh, y));
      return { x, y, k };
    },
    [W, H, availW, availH, size.w, size.h, minK, maxK],
  );

  const apply = useCallback(
    (v: View, animated = false) => {
      const c = clamp(v);
      viewRef.current = c;
      window.clearTimeout(animTimer.current);
      setAnimate(animated);
      if (animated) animTimer.current = window.setTimeout(() => setAnimate(false), 450);
      setViewState(c);
    },
    [clamp],
  );

  const fit = useCallback(
    (animated = false) => {
      touched.current = false;
      apply({ x: 0, y: 0, k: fitK }, animated);
    },
    [apply, fitK],
  );

  const zoomAt = useCallback(
    (cx: number, cy: number, k: number, animated = false) => {
      const v = viewRef.current;
      const nk = Math.min(maxK, Math.max(minK, k));
      const wx = (cx - v.x) / v.k;
      const wy = (cy - v.y) / v.k;
      touched.current = true;
      apply({ x: cx - wx * nk, y: cy - wy * nk, k: nk }, animated);
    },
    [apply, maxK, minK],
  );

  // Measure the container.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit on first measure / when the map changes / on resize until the visitor moves the map.
  useLayoutEffect(() => {
    if (!size.w) return;
    if (!touched.current) apply({ x: 0, y: 0, k: fitK });
    else apply(viewRef.current);
  }, [size.w, size.h, fitK, W, H]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => window.clearTimeout(animTimer.current), []);

  // ---- focus a point (from the list or a keyboard-focused marker) -----------------------
  const centreOn = useCallback(
    (p: Point, zoomIn: boolean) => {
      const k = zoomIn ? Math.max(viewRef.current.k, fitK * 2.5) : viewRef.current.k;
      // Aim a bit above the middle so the bottom sheet on phones does not cover it.
      const tx = size.w / 2;
      const ty = SAFE_TOP + availH * (size.w < 768 ? 0.3 : 0.5);
      touched.current = true;
      apply({ x: tx - p.x * W * k, y: ty - p.y * H * k, k }, true);
    },
    [apply, fitK, size.w, availH, W, H],
  );

  const lastNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!focusRequest || focusRequest.nonce === lastNonce.current || !size.w) return;
    lastNonce.current = focusRequest.nonce;
    const p = points.find((q) => q.id === focusRequest.id);
    if (p) centreOn(p, true);
  }, [focusRequest, points, size.w, centreOn]);

  const ensureVisible = useCallback(
    (p: Point) => {
      const v = viewRef.current;
      const sx = v.x + p.x * W * v.k;
      const sy = v.y + p.y * H * v.k;
      const pad = 30;
      if (sx < pad || sx > size.w - pad || sy < SAFE_TOP || sy > size.h - SAFE_BOTTOM) centreOn(p, false);
    },
    [W, H, size.w, size.h, centreOn],
  );

  // ---- gestures: pointer events (touch pan + pinch, mouse drag), wheel, keyboard --------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ mode: "pan" | "pinch"; start: View; sx: number; sy: number; dist: number; mx: number; my: number } | null>(null);
  const moved = useRef(false);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const beginGesture = () => {
    const pts = [...pointers.current.values()];
    const start = viewRef.current;
    if (pts.length >= 2) {
      const [a, b] = pts;
      gesture.current = { mode: "pinch", start, sx: 0, sy: 0, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    } else if (pts.length === 1) {
      gesture.current = { mode: "pan", start, sx: pts[0].x, sy: pts[0].y, dist: 0, mx: 0, my: 0 };
    } else gesture.current = null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 1) moved.current = false;
    beginGesture();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e));
    const g = gesture.current;
    if (!g) return;
    if (g.mode === "pan") {
      const p = pointers.current.get(e.pointerId)!;
      const dx = p.x - g.sx;
      const dy = p.y - g.sy;
      if (!moved.current && Math.hypot(dx, dy) < TAP_SLOP) return;
      if (!moved.current) {
        moved.current = true;
        box.current?.setPointerCapture?.(e.pointerId); // only now, so plain taps still reach the marker buttons
      }
      touched.current = true;
      apply({ ...g.start, x: g.start.x + dx, y: g.start.y + dy });
    } else {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const k = Math.min(maxK, Math.max(minK, g.start.k * (dist / g.dist)));
      const wx = (g.mx - g.start.x) / g.start.k;
      const wy = (g.my - g.start.y) / g.start.k;
      moved.current = true;
      touched.current = true;
      apply({ x: mx - wx * k, y: my - wy * k, k });
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    box.current?.hasPointerCapture?.(e.pointerId) && box.current.releasePointerCapture(e.pointerId);
    beginGesture(); // continue as a pan with the remaining finger, if any
  };

  // A drag must not count as a tap on a marker or on the empty map.
  const onClickCapture = (e: React.MouseEvent) => {
    if (moved.current) {
      e.stopPropagation();
      e.preventDefault();
      moved.current = false;
    }
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015) * (e.deltaMode === 1 ? 16 : 1));
      zoomAt(e.clientX - r.left, e.clientY - r.top, viewRef.current.k * factor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const v = viewRef.current;
    const step = 60;
    const cx = size.w / 2;
    const cy = SAFE_TOP + availH / 2;
    const pan = (dx: number, dy: number) => {
      touched.current = true;
      apply({ ...v, x: v.x + dx, y: v.y + dy }, true);
    };
    switch (e.key) {
      case "ArrowLeft": pan(step, 0); break;
      case "ArrowRight": pan(-step, 0); break;
      case "ArrowUp": pan(0, step); break;
      case "ArrowDown": pan(0, -step); break;
      case "+": case "=": zoomAt(cx, cy, v.k * 1.4, true); break;
      case "-": case "_": zoomAt(cx, cy, v.k / 1.4, true); break;
      case "0": fit(true); break;
      case "Escape": if (selectedId) onSelect(null); return;
      default: return;
    }
    e.preventDefault();
  };

  const zoomBy = (f: number) => zoomAt(size.w / 2, SAFE_TOP + availH / 2, viewRef.current.k * f, true);

  const inv = 1 / view.k;
  const stageStyle = {
    width: W,
    height: H,
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
    "--inv": inv,
  } as React.CSSProperties;

  return (
    <div
      ref={box}
      className="map-viewer"
      role="group"
      aria-roledescription="map"
      aria-label={t("mapHint")}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onClickCapture={onClickCapture}
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "IMG") onSelect(null);
      }}
      onKeyDown={onKeyDown}
      onScroll={(e) => {
        // Focusing a marker can make the browser scroll this overflow:hidden box; keep it at 0.
        e.currentTarget.scrollLeft = 0;
        e.currentTarget.scrollTop = 0;
      }}
    >
      <div className={"map-stage" + (animate ? " animating" : "")} style={stageStyle}>
        {/* Event maps are shown through <img> only, never inlined (SVG could carry scripts). */}
        <img
          className="map-image"
          src={imageUrl}
          alt={t("mapImageAlt")}
          width={W}
          height={H}
          draggable={false}
          decoding="async"
          onLoad={() => setImgState("ok")}
          onError={() => setImgState("error")}
        />
        {points.map((p) => (
          <Marker
            key={p.id}
            point={p}
            theme={theme}
            selected={p.id === selectedId}
            label={`${p.name}, ${categoryLabel(p.category)}`}
            onSelect={onSelect}
            onFocusPoint={ensureVisible}
          />
        ))}
      </div>

      {imgState === "loading" && <div className="map-status" role="status">{t("loading")}</div>}
      {imgState === "error" && <div className="map-status error" role="alert">{t("mapImageFailed")}</div>}

      <div className="zoom-controls">
        <button type="button" className="icon-btn" onClick={() => zoomBy(1.5)} aria-label={t("zoomIn")}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button type="button" className="icon-btn" onClick={() => zoomBy(1 / 1.5)} aria-label={t("zoomOut")}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12h14" /></svg>
        </button>
        <button type="button" className="icon-btn" onClick={() => fit(true)} aria-label={t("zoomReset")}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
        </button>
      </div>
    </div>
  );
}

type MarkerProps = {
  point: Point;
  theme: MapTheme;
  selected: boolean;
  label: string;
  onSelect: (id: string | null) => void;
  onFocusPoint: (p: Point) => void;
};

const Marker = memo(function Marker({ point, theme, selected, label, onSelect, onFocusPoint }: MarkerProps) {
  const sz = selected ? TOKEN_SIZE.selected : TOKEN_SIZE.default;
  const off = 22 - sz.anchor; // centre the token's anchor in the 44x44 hit box
  return (
    <button
      type="button"
      className={"marker" + (selected ? " selected" : "")}
      data-point-id={point.id}
      style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%`, zIndex: selected ? 2000 : Math.round(point.y * 1000) }}
      aria-label={label}
      aria-pressed={selected}
      onClick={() => onSelect(selected ? null : point.id)}
      onFocus={() => onFocusPoint(point)}
    >
      <span className="marker-art" style={{ left: off, top: off }}>
        <MarkerToken category={point.category} theme={theme} selected={selected} />
      </span>
      {selected && (
        <span className="marker-arrow">
          <QuestArrow theme={theme} />
        </span>
      )}
    </button>
  );
});
