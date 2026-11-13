import { POINT_CATEGORIES, type MapBundle, type MapTheme, type Point } from "@atlas/contract";

/** Raw facts about an Event Map as stored. Free of framework and I/O types. */
export interface StoredEventMap {
  event: { slug: string; name: string; startDate: string; endDate: string; language: string };
  map: {
    id: string;
    theme: MapTheme;
    width: number;
    height: number;
    imageKey: string;
    imageFormat: "svg" | "webp";
  };
  points: Point[];
}

const CATEGORY_ORDER = new Map<string, number>(POINT_CATEGORIES.map((c, i) => [c, i]));

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Business rule: points are ordered by category enum order, then name, then id. */
export function sortPoints(points: readonly Point[]): Point[] {
  return [...points].sort(
    (a, b) =>
      (CATEGORY_ORDER.get(a.category) ?? Number.MAX_SAFE_INTEGER) -
        (CATEGORY_ORDER.get(b.category) ?? Number.MAX_SAFE_INTEGER) ||
      cmp(a.name, b.name) ||
      cmp(a.id, b.id),
  );
}

/** Image URL builder. Slice 01: static assets under /maps/. Slice 02 swaps this for R2. */
export function imageUrl(imageKey: string): string {
  return `/maps/${imageKey}`;
}

export function toMapBundle(stored: StoredEventMap): MapBundle {
  return {
    event: stored.event,
    map: {
      id: stored.map.id,
      theme: stored.map.theme,
      width: stored.map.width,
      height: stored.map.height,
      image: {
        format: stored.map.imageFormat,
        variants: [{ url: imageUrl(stored.map.imageKey), width: stored.map.width }],
      },
    },
    points: sortPoints(stored.points),
  };
}
