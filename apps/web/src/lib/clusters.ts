// Slice 23: grouping of overlapping pins (screen space) and the layout of the split ring. Pure functions, no DOM.

export const CLUSTER_PX = 44; // pins whose tips are closer than this merge
export const FAN_MAX = 8; // above this a tap zooms (rule 1) or opens a list (rule 2) instead of fanning out
export const ZOOM_PADDING = 72;
export const CLUSTER_ANCHOR = { x: 28, y: 60 }; // tip inside the 64x66 cluster box
export const CLUSTER_HEAD_RISE = 29; // head centre sits this far above the tip (same as a normal pin)

export type Pin = { id: string; x: number; y: number }; // x, y: any consistent unit (map px at the current zoom)
export type Cluster<T extends Pin = Pin> = { key: string; anchor: T; members: T[] };
export type Grouped<T extends Pin = Pin> = { singles: T[]; clusters: Cluster<T>[] };

/**
 * Greedy pass in pin order: each unassigned pin starts a group and takes every other unassigned pin closer than `threshold`.
 * The selected pin never joins a group. A group of one is a plain pin. The group is anchored at the member closest to the centroid.
 */
export function groupPins<T extends Pin>(pins: T[], selectedId: string | null, threshold = CLUSTER_PX): Grouped<T> {
  const list = selectedId ? pins.filter((p) => p.id !== selectedId) : pins;
  const used = new Set<string>();
  const singles: T[] = [];
  const clusters: Cluster<T>[] = [];
  for (const p of list) {
    if (used.has(p.id)) continue;
    used.add(p.id);
    const members = [p];
    for (const q of list) {
      if (used.has(q.id)) continue;
      if (Math.hypot(p.x - q.x, p.y - q.y) < threshold) {
        used.add(q.id);
        members.push(q);
      }
    }
    if (members.length === 1) {
      singles.push(p);
      continue;
    }
    const cx = members.reduce((s, m) => s + m.x, 0) / members.length;
    const cy = members.reduce((s, m) => s + m.y, 0) / members.length;
    let anchor = members[0]!;
    let best = Infinity;
    for (const m of members) {
      const d = Math.hypot(m.x - cx, m.y - cy);
      if (d < best) {
        best = d;
        anchor = m;
      }
    }
    clusters.push({ key: members.map((m) => m.id).join("|"), anchor, members });
  }
  return { singles, clusters };
}

/** True when every member sits on the same spot (zooming can never separate them). */
export function allSamePlace(members: Pin[]): boolean {
  const a = members[0];
  return !!a && members.every((m) => Math.abs(m.x - a.x) < 1e-9 && Math.abs(m.y - a.y) < 1e-9);
}

export const fanRadius = (n: number) => Math.max(64, 30 / Math.sin(Math.PI / Math.max(n, 2)));

/** Offsets (from the ring centre) of the fanned pins' head centres: start at 12 o'clock, clockwise; two pins go left and right. */
export function ringOffsets(n: number): { dx: number; dy: number }[] {
  const r = fanRadius(n);
  return Array.from({ length: n }, (_, i) => {
    const a = n === 2 ? (i === 0 ? Math.PI : 0) : -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { dx: Math.cos(a) * r, dy: Math.sin(a) * r };
  });
}

/** Shift the ring centre so every fanned pin (48x56 box around its head centre) stays inside the usable area. */
export function fitRing(c: { x: number; y: number }, offs: { dx: number; dy: number }[], area: { left: number; top: number; right: number; bottom: number }) {
  const minDx = Math.min(...offs.map((o) => o.dx));
  const maxDx = Math.max(...offs.map((o) => o.dx));
  const minDy = Math.min(...offs.map((o) => o.dy));
  const maxDy = Math.max(...offs.map((o) => o.dy));
  // Head centre is 23 px below the top of the box and 33 px above its bottom; half width 24.
  const loX = area.left + 24 - minDx;
  const hiX = area.right - 24 - maxDx;
  const loY = area.top + 23 - minDy;
  const hiY = area.bottom - 33 - maxDy;
  return { x: loX > hiX ? (loX + hiX) / 2 : Math.min(hiX, Math.max(loX, c.x)), y: loY > hiY ? (loY + hiY) / 2 : Math.min(hiY, Math.max(loY, c.y)) };
}
