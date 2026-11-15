import type { EventPreviewResponse, Point } from "@atlas/contract";
import { mediaUrl } from "../adapters/d1-map-image-repository";
import type { OwnedEvent } from "../adapters/d1-panel-event-repository";

/**
 * The event as visitors will see it: public-shaped fields, with the uploaded map when there is one. Shared by the
 * owner preview and the Admin review, so both show exactly what publishing would show.
 */
export function toPreviewBody(e: OwnedEvent, points: Point[]): EventPreviewResponse {
  return {
    event: {
      slug: e.slug,
      name: e.name,
      startDate: e.startDate,
      endDate: e.endDate,
      language: e.language,
      timeZone: e.timeZone,
      dayStart: e.dayStart,
      city: e.city,
      country: e.country,
      ...(e.description ? { description: e.description } : {}),
      ...(e.website ? { website: e.website } : {}),
    },
    map: e.storedMap
      ? {
          id: e.id,
          theme: e.storedMap.theme,
          width: e.storedMap.fullWidth,
          height: e.storedMap.fullHeight,
          image: {
            format: e.storedMap.format,
            variants: [
              { url: mediaUrl(e.storedMap.smallKey), width: e.storedMap.smallWidth },
              { url: mediaUrl(e.storedMap.fullKey), width: e.storedMap.fullWidth },
            ].sort((a, b) => a.width - b.width),
          },
        }
      : null,
    points,
    sessions: [],
  };
}
