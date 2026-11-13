import { mapBundleSchema, type MapBundle } from "@atlas/contract";
import { toMapBundle, type StoredEventMap } from "../domain/map-bundle";

/** Port. Implemented by the D1 adapter. */
export interface EventMapRepository {
  /** First Event Map (lowest position) of the event with this slug, with its points. */
  findFirstMapBySlug(slug: string): Promise<StoredEventMap | null>;
}

/** Slug must already be validated by the caller. Returns null when the event is unknown. */
export async function getMapBundle(repo: EventMapRepository, slug: string): Promise<MapBundle | null> {
  const stored = await repo.findFirstMapBySlug(slug);
  if (!stored) return null;
  // Output validation: never serve a payload that breaks the contract.
  return mapBundleSchema.parse(toMapBundle(stored));
}
