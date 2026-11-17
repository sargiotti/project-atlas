import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Point } from "@atlas/contract";
import { MarkerToken, QuestArrow, PIN_ANCHOR, SELECTED_SCALE, type MapTheme } from "../markers/Pixel";
import { useI18n } from "../i18n/I18nProvider";
import { pointAriaLabel } from "../lib/pointLabel";
import { allSamePlace, CLUSTER_HEAD_RISE, FAN_MAX, fitRing, groupPins, ringOffsets, ZOOM_PADDING } from "../lib/clusters";
import { ClusterFan, ClusterList, ClusterMarker, useClusterLabel, type FanState } from "./ClusterParts";

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
  /** Same-origin image variants, ascending by width (small, full). The viewer starts on the smallest that is sharp enough and only ever upgrades. */
  variants?: { url: string; width: number }[];
  width: number;
  height: number;
  points: Point[];
  theme: MapTheme;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Ask the map to centre on a point; a new nonce re-triggers it. */
  focusRequest: { id: string; nonce: number } | null;
  categoryLabel: (category: string) => string;
  /** The map image could not be loaded (the page may refetch the bundle once: the organizer may have replaced the map). */
  onImageError?: () => void;
  /** The map image finished loading (the visitor page uses it to time the one-off view hint). */
  onImageLoaded?: () => void;
  /** Space the page keeps free at the top / bottom (the visitor page floats a top bar and a switch over the map). */
  safe?: { top: number; bottom: number };
  /** Slice 23: merge overlapping pins into clusters. Only the visitor map turns it on; the Points editor keeps every pin. */
  clusters?: boolean;
  /** Slice 08c: the organizer's editor. Absent on the visitor page, where nothing below changes. */
  edit?: MapEdit;
};

/** Hooks the Points editor plugs into the shared pan/zoom viewer (coordinates are normalized 0..1, top-left origin). */
export type MapEdit = {
  /** Receives the transformed stage element, so drops can be converted to map coordinates. */
  stageRef?: React.RefObject<HTMLDivElement | null>;
  /** A click on the map surface (not on a pin or a control), already converted to 0..1. Outside the map: `inside` is false. */
  onMapClick?: (x: number, y: number, inside: boolean) => void;
  /** A pin dragged with the pointer. `end` is the release. */
  onMarkerDrag?: (id: string, x: number, y: number, phase: "move" | "end") => void;
  /** Pins that wobble with a "?" (a Name-it Point still without a name). */
  pendingIds?: ReadonlySet<string>;
  /** Pin shown with a ping ring (hovered in the Placed list). */
  highlightId?: string | null;
  /** Pin that just landed (stamp animation). */
  stampId?: string | null;
  /** A palette piece is armed: the map shows a crosshair. */
  armed?: boolean;
  /** Text of a pin's tooltip. */
  tipOf?: (p: Point) => string;
};

export default function MapViewer({ imageUrl, variants, width: W, height: H, points, theme, selectedId, onSelect, focusRequest, categoryLabel, onImageError, onImageLoaded, safe, edit, clusters: clustersOn = false }: Props) {
  const safeTop = safe?.top ?? SAFE_TOP;
  const safeBottom = safe?.bottom ?? SAFE_BOTTOM;
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [view, setViewState] = useState<View>({ x: 0, y: 0, k: 1 });
  const [animate, setAnimate] = useState(false);
  const [imgState, setImgState] = useState<"loading" | "ok" | "error">("loading");
  const viewRef = useRef(view);
  const [level, setLevel] = useState(0);
  const touched = useRef(false);
  const animTimer = useRef<number | undefined>(undefined);

  // ---- slice 23: clusters. Groups follow the zoom that has settled (never mid-pinch) and the selection; panning never changes them.
  const [settledK, setSettledK] = useState(1);
  const [fan, setFan] = useState<FanState | null>(null);
  const [list, setList] = useState<{ key: string; members: Point[]; at: { x: number; y: number } } | null>(null);
  const [live, setLive] = useState("");
  const fanOpen = useRef(false);
  const listOpen = useRef(false);
  const refocusKey = useRef<string | null>(null);
  const focusAfterZoom = useRef<string | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  fanOpen.current = !!fan;
  listOpen.current = !!list;

  // ---- geometry -------------------------------------------------------------------------
  const availW = Math.max(1, size.w - SIDE_MARGIN * 2);
  const availH = Math.max(1, size.h - safeTop - safeBottom);
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
      if (sh <= availH) y = safeTop + (availH - sh) / 2;
      else y = Math.min(safeTop, Math.max(size.h - safeBottom - sh, y));
      return { x, y, k };
    },
    [W, H, availW, availH, size.w, size.h, minK, maxK, safeTop, safeBottom],
  );

  const apply = useCallback(
    (v: View, animated = false) => {
      const c = clamp(v);
      if (fanOpen.current || listOpen.current) {
        // Any zoom or pan closes the split / the list at once.
        window.clearTimeout(closeTimer.current);
        setFan(null);
        setList(null);
      }
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

  // Variant choice: device pixels needed for the current zoom vs variant widths. Upgrades preload first (no blank frame).
  const sharp = variants?.length ? variants : null;
  useEffect(() => {
    if (!sharp || !size.w || level >= sharp.length - 1) return;
    const need = W * view.k * (window.devicePixelRatio || 1);
    const want = sharp.findIndex((v) => v.width >= need);
    const idx = want === -1 ? sharp.length - 1 : want;
    if (idx <= level) return;
    let live = true;
    const pre = new Image();
    pre.onload = pre.onerror = () => live && setLevel((l) => Math.max(l, idx));
    pre.src = sharp[idx]!.url;
    return () => {
      live = false;
    };
  }, [variants, sharp, size.w, view.k, W, level]);
  const src = sharp ? sharp[Math.min(level, sharp.length - 1)]!.url : imageUrl;

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

  useEffect(() => () => {
    window.clearTimeout(animTimer.current);
    window.clearTimeout(closeTimer.current);
  }, []);

  // The first fit (before the visitor moves the map) settles at once, so there is no pop-in; later zooms settle when they end.
  useLayoutEffect(() => {
    if (size.w && !touched.current) setSettledK(fitK);
  }, [size.w, size.h, fitK]);
  useEffect(() => {
    if (!clustersOn || view.k === settledK) return;
    const id = window.setTimeout(() => {
      if (pointers.current.size >= 2) return; // fingers still down: endPointer settles
      setSettledK(viewRef.current.k);
    }, animate ? 380 : 150);
    return () => window.clearTimeout(id);
  }, [clustersOn, view.k, settledK, animate]);

  const grouped = useMemo(
    () => (clustersOn ? groupPins(points.map((p) => ({ id: p.id, x: p.x * W * settledK, y: p.y * H * settledK })), selectedId) : null),
    [clustersOn, points, W, H, settledK, selectedId],
  );
  const byId = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);
  const clusterList = useMemo(
    () => (grouped ? grouped.clusters.map((c) => ({ key: c.key, anchor: byId.get(c.anchor.id)!, members: c.members.map((m) => byId.get(m.id)!) })) : []),
    [grouped, byId],
  );
  const clustered = useMemo(() => new Set(clusterList.flatMap((c) => c.members.map((m) => m.id))), [clusterList]);
  const clusterLabel = useClusterLabel();
  // A new grouping (zoom end, selection change) closes whatever was open on the old one.
  useEffect(() => {
    setFan(null);
    setList(null);
  }, [grouped]);
  // After a zoom a keyboard user lands on the first member (as a pin or inside a smaller cluster).
  useEffect(() => {
    const id = focusAfterZoom.current;
    if (!id || !box.current) return;
    focusAfterZoom.current = null;
    const el = [...box.current.querySelectorAll<HTMLElement>("[data-point-id], [data-cluster]")].find((n) => n.dataset.pointId === id || n.dataset.cluster?.split("|").includes(id));
    el?.focus({ preventScroll: true });
  }, [grouped]);
  // Closing the split or the list gives focus back to the cluster that opened it.
  useEffect(() => {
    if (fan || list || !refocusKey.current || !box.current) return;
    const key = refocusKey.current;
    refocusKey.current = null;
    [...box.current.querySelectorAll<HTMLElement>("[data-cluster]")].find((n) => n.dataset.cluster === key)?.focus({ preventScroll: true });
  }, [fan, list]);

  const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const closeFan = () => {
    if (!fan || fan.closing) return;
    refocusKey.current = fan.key;
    if (reduced()) return setFan(null);
    setFan({ ...fan, closing: true });
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setFan(null), 170);
  };
  const closeList = () => {
    if (list) refocusKey.current = list.key;
    setList(null);
  };
  // Escape closes the split or the list wherever focus is (after a tap it can be on the body).
  const escRef = useRef<() => void>(() => {});
  escRef.current = () => (fan ? closeFan() : closeList());
  const isOpen = !!fan || !!list;
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      escRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // ---- focus a point (from the list or a keyboard-focused marker) -----------------------
  const centreOn = useCallback(
    (p: Point, zoomIn: boolean) => {
      const k = zoomIn ? Math.max(viewRef.current.k, fitK * 2.5) : viewRef.current.k;
      // Aim a bit above the middle so the bottom sheet on phones does not cover it.
      const tx = size.w / 2;
      let ty = safeTop + availH * (size.w < 768 ? 0.3 : 0.5);
      // A sheet that is already open (e.g. "See on map" from the Schedule): centre in the free area above it.
      const sheet = size.w < 768 ? box.current?.ownerDocument.querySelector(".sheet") : null;
      if (sheet && box.current) {
        const free = sheet.getBoundingClientRect().top - box.current.getBoundingClientRect().top;
        if (free > safeTop + 40) ty = safeTop + (free - safeTop) / 2;
      }
      touched.current = true;
      apply({ x: tx - p.x * W * k, y: ty - p.y * H * k, k }, true);
    },
    [apply, fitK, size.w, availH, W, H, safeTop],
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
      if (sx < pad || sx > size.w - pad || sy < safeTop || sy > size.h - safeBottom) centreOn(p, false);
    },
    [W, H, size.w, size.h, centreOn, safeTop, safeBottom],
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
    const wasPinch = pointers.current.size >= 2;
    pointers.current.delete(e.pointerId);
    if (wasPinch && clustersOn) setSettledK(viewRef.current.k);
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
    const cy = safeTop + availH / 2;
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

  const zoomBy = (f: number) => zoomAt(size.w / 2, safeTop + availH / 2, viewRef.current.k * f, true);

  const stageEl = useRef<HTMLDivElement | null>(null);
  const setStage = useCallback(
    (el: HTMLDivElement | null) => {
      stageEl.current = el;
      if (edit?.stageRef) edit.stageRef.current = el;
    },
    [edit?.stageRef],
  );

  // Tap on a cluster: split in place (8 or fewer), zoom to its members (more), or list them when zooming cannot separate them.
  const onClusterTap = (key: string, byKeyboard: boolean) => {
    const c = clusterList.find((x) => x.key === key);
    if (!c) return;
    window.clearTimeout(closeTimer.current);
    const v = viewRef.current;
    const n = c.members.length;
    const tip = { x: v.x + c.anchor.x * W * v.k, y: v.y + c.anchor.y * H * v.k };
    if (n <= FAN_MAX) {
      const offs = ringOffsets(n);
      const centre = fitRing({ x: tip.x, y: tip.y - CLUSTER_HEAD_RISE }, offs, { left: 8, top: safeTop, right: size.w - 8, bottom: size.h - safeBottom });
      setList(null);
      setFan({
        key,
        members: c.members,
        cx: centre.x,
        cy: centre.y,
        offs,
        spots: c.members.map((m) => ({ x: v.x + m.x * W * v.k, y: v.y + m.y * H * v.k })),
        closing: false,
      });
      return;
    }
    // Rule 1: zoom to fit the members (72 px padding, capped by the viewer's max zoom).
    const same = allSamePlace(c.members);
    const xs = c.members.map((m) => m.x * W);
    const ys = c.members.map((m) => m.y * H);
    const bb = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    const target = same ? 0 : Math.min(maxK, (availW - 2 * ZOOM_PADDING) / Math.max(bb.x1 - bb.x0, 1), (availH - 2 * ZOOM_PADDING) / Math.max(bb.y1 - bb.y0, 1));
    if (!same && target > v.k * 1.05) {
      touched.current = true;
      if (byKeyboard) focusAfterZoom.current = c.members[0]!.id;
      apply({ x: size.w / 2 - ((bb.x0 + bb.x1) / 2) * target, y: safeTop + availH / 2 - ((bb.y0 + bb.y1) / 2) * target, k: target }, true);
      setLive(t("clusterZoomed" as any, { n }));
      window.setTimeout(() => setLive(""), 3000);
      return;
    }
    // Rule 2: nothing left to zoom into (identical spot, or already at the max zoom): a plain list.
    setFan(null);
    setList({ key, members: c.members, at: tip });
  };
  const pickFromCluster = (id: string) => {
    setFan(null);
    setList(null);
    onSelect(id);
  };

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
      className={"map-viewer" + (edit?.armed ? " armed" : "")}
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
        if (edit?.onMapClick) {
          // Editor: a click on a pin or a control is theirs; anything else is a click on the map (or beside it).
          if ((e.target as HTMLElement).closest(".marker, .zoom-controls")) return;
          const r = stageEl.current?.getBoundingClientRect();
          if (!r || !r.width) return;
          const x = (e.clientX - r.left) / r.width;
          const y = (e.clientY - r.top) / r.height;
          edit.onMapClick(x, y, x >= 0 && x <= 1 && y >= 0 && y <= 1);
          return;
        }
        if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "IMG") onSelect(null);
      }}
      onKeyDown={onKeyDown}
      onScroll={(e) => {
        // Focusing a marker can make the browser scroll this overflow:hidden box; keep it at 0.
        e.currentTarget.scrollLeft = 0;
        e.currentTarget.scrollTop = 0;
      }}
    >
      <div ref={setStage} className={"map-stage" + (animate ? " animating" : "")} style={stageStyle}>
        {/* Event maps are shown through <img> only, never inlined (SVG could carry scripts). */}
        <img
          className="map-image"
          src={src}
          alt={t("mapImageAlt")}
          width={W}
          height={H}
          draggable={false}
          decoding="async"
          onLoad={() => {
            setImgState("ok");
            onImageLoaded?.();
          }}
          onError={() => {
            setImgState("error");
            onImageError?.();
          }}
        />
        {points.map((p) => clustered.has(p.id) ? null : (
          <Marker
            key={p.id}
            point={p}
            theme={theme}
            selected={p.id === selectedId}
            label={pointAriaLabel(p, categoryLabel)}
            onSelect={onSelect}
            onFocusPoint={ensureVisible}
            stage={edit ? stageEl : undefined}
            onDrag={edit?.onMarkerDrag}
            pending={edit?.pendingIds?.has(p.id)}
            highlighted={edit?.highlightId === p.id}
            stamped={edit?.stampId === p.id}
            tip={edit?.tipOf?.(p)}
          />
        ))}
        {clusterList.map((c) => (
          <ClusterMarker
            key={c.key}
            clusterKey={c.key}
            anchor={c.anchor}
            members={c.members}
            theme={theme}
            open={fan?.key === c.key}
            label={clusterLabel(c.members)}
            onTap={onClusterTap}
          />
        ))}
      </div>

      {fan && <ClusterFan fan={fan} theme={theme} label={clusterLabel(fan.members)} onPick={pickFromCluster} onClose={closeFan} />}
      {list && <ClusterList members={list.members} at={list.at} wide={size.w >= 768} onPick={pickFromCluster} onClose={closeList} />}
      {clustersOn && <div className="sr-only" role="status" aria-live="polite">{live}</div>}

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
  /** Editor only: the stage (for pointer to 0..1), the drag callback and the pin states. */
  stage?: React.RefObject<HTMLDivElement | null>;
  onDrag?: MapEdit["onMarkerDrag"];
  pending?: boolean;
  highlighted?: boolean;
  stamped?: boolean;
  tip?: string;
};

const DRAG_SLOP = 5;

const Marker = memo(function Marker({ point, theme, selected, label, onSelect, onFocusPoint, stage, onDrag, pending, highlighted, stamped, tip }: MarkerProps) {
  const k = selected ? SELECTED_SCALE : 1;
  // The 48x56 button has its tip at (24,52); a selected pin grows from the tip, not the centre.
  const offX = PIN_ANCHOR.x * (1 - k);
  const offY = PIN_ANCHOR.y * (1 - k);
  // Editor: drag a pin with Pointer Events. Below the slop it stays a click (select).
  const drag = useRef<{ id: number; sx: number; sy: number; dx: number; dy: number; active: boolean } | null>(null);
  const swallowClick = useRef(false);
  const toMap = (e: React.PointerEvent, d: NonNullable<typeof drag.current>) => {
    const r = stage!.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - d.dx - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - d.dy - r.top) / r.height)) };
  };
  const dragProps = onDrag && stage
    ? {
        onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
          if (e.button !== 0 || !stage.current) return;
          e.stopPropagation(); // the viewer must not start panning
          const r = stage.current.getBoundingClientRect();
          // Keep the grab offset, so the pin does not jump to the pointer.
          drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, dx: e.clientX - (r.left + point.x * r.width), dy: e.clientY - (r.top + point.y * r.height), active: false };
        },
        onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          if (!d.active) {
            if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_SLOP) return;
            d.active = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }
          const m = toMap(e, d);
          onDrag(point.id, m.x, m.y, "move");
        },
        onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.id !== e.pointerId || !d.active) return;
          swallowClick.current = true;
          const m = toMap(e, d);
          onDrag(point.id, m.x, m.y, "end");
        },
        onPointerCancel: () => {
          const d = drag.current;
          drag.current = null;
          if (d?.active) onDrag(point.id, point.x, point.y, "end");
        },
      }
    : {};
  return (
    <button
      type="button"
      className={"marker" + (selected ? " selected" : "") + (pending ? " pending" : "") + (highlighted ? " hl" : "") + (stamped ? " stamp" : "") + (onDrag ? " draggable" : "")}
      {...dragProps}
      data-point-id={point.id}
      style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%`, zIndex: selected ? 2000 : Math.round(point.y * 1000) }}
      aria-label={label}
      aria-pressed={selected}
      onClick={(e) => {
        if (swallowClick.current) {
          swallowClick.current = false;
          e.stopPropagation();
          return;
        }
        // The editor keeps a clicked pin selected (clicking again does not deselect: there is the Inspector to use).
        onSelect(selected && !onDrag ? null : point.id);
      }}
      onFocus={() => onFocusPoint(point)}
    >
      <span className="marker-art" style={{ left: offX, top: offY }}>
        <MarkerToken category={point.category} theme={theme} selected={selected} />
      </span>
      {selected && (
        <span className="marker-arrow">
          <QuestArrow theme={theme} />
        </span>
      )}
      {tip && <span className="marker-tip">{tip}</span>}
    </button>
  );
});
