import { memo, useEffect, useRef, useState } from "react";
import type { Point } from "@atlas/contract";
import { CategoryIcon, ClusterCloseToken, ClusterToken, MarkerToken, pinBody, type MapTheme } from "../markers/Pixel";
import { useI18n } from "../i18n/I18nProvider";
import { displayName } from "../lib/pointLabel";
import { CLUSTER_HEAD_RISE } from "../lib/clusters";

/** "5 points: Main Stage, Bar Norte, Merch Tent and 2 more". Names are event content: this string goes to React text / aria-label only. */
export function useClusterLabel() {
  const { t } = useI18n();
  return (members: Point[]) => {
    const names = members.slice(0, 3).map((m) => displayName(m, t)).join(", ");
    const more = members.length - 3;
    return more > 0 ? t("clusterLabelMore" as any, { n: members.length, names, more }) : t("clusterLabel" as any, { n: members.length, names });
  };
}

/** The merged marker inside the zooming stage: counter-scaled like a pin (screen-constant size), tip on the anchor point. */
export const ClusterMarker = memo(function ClusterMarker({
  clusterKey, anchor, members, theme, open, label, onTap,
}: {
  clusterKey: string;
  anchor: Point;
  members: Point[];
  theme: MapTheme;
  open: boolean;
  label: string;
  onTap: (key: string, byKeyboard: boolean) => void;
}) {
  const colors = members.slice(1, 3).map((m) => pinBody(m.category, theme));
  return (
    <button
      type="button"
      className={"cluster-marker" + (open ? " open" : "")}
      data-cluster={clusterKey}
      style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%`, zIndex: Math.round(anchor.y * 1000) }}
      aria-label={label}
      aria-expanded={open}
      onClick={(e) => onTap(clusterKey, e.detail === 0)}
    >
      <ClusterToken count={members.length} colors={colors} />
    </button>
  );
});

export type FanState = {
  key: string;
  members: Point[];
  /** Screen position of the ring centre (the cluster head, possibly shifted inward). */
  cx: number;
  cy: number;
  offs: { dx: number; dy: number }[];
  /** Screen position of each member's true spot (pin tip). */
  spots: { x: number; y: number }[];
  closing: boolean;
};

/**
 * Cell split (slice 23): the members fan out of the cluster in a ring, with leader lines and dots to their true spots, over a dimmed map.
 * Lives in a fixed-size layer above the zooming stage (screen px, not counter-scaled). Only transform and opacity animate.
 */
export function ClusterFan({ fan, theme, label, onPick, onClose }: { fan: FanState; theme: MapTheme; label: string; onPick: (id: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [on, setOn] = useState(false);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  // Focus moves to the first fanned pin when the split opens (the cluster itself is hidden then).
  useEffect(() => first.current?.focus({ preventScroll: true }), []);

  const shown = on && !fan.closing;
  return (
    <div className={"cluster-fan" + (shown ? " on" : "") + (fan.closing ? " closing" : "")} role="group" aria-label={label}>
      <div className="cluster-scrim" onClick={onClose} aria-hidden="true" />
      <svg className="cluster-lines" aria-hidden="true">
        {fan.members.map((m, i) => {
          const s = fan.spots[i]!;
          const x2 = fan.cx + fan.offs[i]!.dx;
          const y2 = fan.cy + fan.offs[i]!.dy + CLUSTER_HEAD_RISE;
          return (
            <g key={m.id} strokeLinecap="round">
              <line x1={s.x} y1={s.y} x2={x2} y2={y2} strokeWidth="3.5" className="halo" />
              <line x1={s.x} y1={s.y} x2={x2} y2={y2} strokeWidth="1.5" className="leader" />
            </g>
          );
        })}
      </svg>
      {fan.members.map((m, i) => (
        <span key={m.id} className="cluster-dot" style={{ left: fan.spots[i]!.x, top: fan.spots[i]!.y, background: pinBody(m.category, theme) }} />
      ))}
      <button type="button" className="cluster-nuc" style={{ left: fan.cx, top: fan.cy }} aria-label={t("clusterClose" as any)} onClick={onClose}>
        <ClusterCloseToken />
      </button>
      {fan.members.map((m, i) => (
        <button
          key={m.id}
          ref={i === 0 ? first : undefined}
          type="button"
          className="cluster-petal"
          data-point-id={m.id}
          style={{ left: fan.cx, top: fan.cy, "--dx": `${fan.offs[i]!.dx}px`, "--dy": `${fan.offs[i]!.dy}px`, "--delay": `${Math.min(i * 12, 84)}ms` } as React.CSSProperties}
          aria-label={`${displayName(m, t)}, ${t(`cat_${m.category}` as any)}`}
          onClick={() => onPick(m.id)}
        >
          <MarkerToken category={m.category} theme={theme} />
        </button>
      ))}
    </div>
  );
}

/** Rule 2 (many pins on one spot): a plain list. Sheet on phones, popover from 768 px. Picking a row selects that pin. */
export function ClusterList({ members, at, wide, onPick, onClose }: { members: Point[]; at: { x: number; y: number }; wide: boolean; onPick: (id: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus({ preventScroll: true }), []);
  const style: React.CSSProperties | undefined = wide ? { left: Math.max(12, at.x + 40), top: Math.max(90, Math.min(at.y - 120, 140)), maxHeight: "calc(100% - 260px)" } : undefined;
  return (
    <>
      <div className="cluster-scrim clear on" onClick={onClose} aria-hidden="true" />
      <section className={"cluster-list" + (wide ? " pop" : "")} style={style} role="dialog" aria-modal="false" aria-labelledby="cluster-list-title">
        <div className="cluster-list-head">
          <h2 id="cluster-list-title">{t("clusterListTitle" as any, { n: members.length })}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t("clusterListClose" as any)}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        {!wide && <p className="muted small">{t("clusterListHint" as any)}</p>}
        <ul>
          {members.map((m, i) => (
            <li key={m.id}>
              <button ref={i === 0 ? first : undefined} type="button" onClick={() => onPick(m.id)}>
                <CategoryIcon category={m.category} size={32} />
                <span className="cl-text">
                  <span className="cl-name">{displayName(m, t)}</span>
                  <small>{t(`cat_${m.category}` as any)}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
