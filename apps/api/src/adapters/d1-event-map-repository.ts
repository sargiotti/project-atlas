import type { EventMapRepository } from "../application/get-map-bundle";
import type { StoredEventMap } from "../domain/map-bundle";

const FIRST_MAP_ID = `(SELECT m.id FROM event_maps m JOIN events e ON e.id = m.event_id
  WHERE e.slug = ?1 ORDER BY m.position LIMIT 1)`;

interface MapRow {
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  language: string;
  map_id: string;
  theme: "light" | "dark";
  width: number;
  height: number;
  image_key: string;
  image_format: "svg" | "webp";
}

interface PointRow {
  id: string;
  category: StoredEventMap["points"][number]["category"];
  name: string;
  description: string;
  x: number;
  y: number;
}

export class D1EventMapRepository implements EventMapRepository {
  constructor(private readonly db: D1Database) {}

  async findFirstMapBySlug(slug: string): Promise<StoredEventMap | null> {
    // One batch, two prepared statements, all values bound (never concatenated).
    // Lookup by the indexed unique slug; bounded to one event and at most 500 points.
    const [mapResult, pointsResult] = await this.db.batch<MapRow | PointRow>([
      this.db
        .prepare(
          `SELECT e.slug, e.name, e.start_date, e.end_date, e.language,
                  m.id AS map_id, m.theme, m.width, m.height, m.image_key, m.image_format
           FROM event_maps m JOIN events e ON e.id = m.event_id
           WHERE m.id = ${FIRST_MAP_ID}`,
        )
        .bind(slug),
      this.db
        .prepare(
          `SELECT id, category, name, description, x, y FROM points
           WHERE map_id = ${FIRST_MAP_ID} LIMIT 500`,
        )
        .bind(slug),
    ]);

    const row = mapResult?.results[0] as MapRow | undefined;
    if (!row) return null;
    const points = (pointsResult?.results ?? []) as PointRow[];

    return {
      event: {
        slug: row.slug,
        name: row.name,
        startDate: row.start_date,
        endDate: row.end_date,
        language: row.language,
      },
      map: {
        id: row.map_id,
        theme: row.theme,
        width: row.width,
        height: row.height,
        imageKey: row.image_key,
        imageFormat: row.image_format,
      },
      points: points.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        description: p.description,
        x: p.x,
        y: p.y,
      })),
    };
  }
}
