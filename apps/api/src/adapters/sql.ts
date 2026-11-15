/**
 * Every visitor-facing read of `events` must include this literal predicate (never a bound parameter, so
 * the partial indexes idx_events_published_v2 / idx_events_pub_updated apply). Only an event the Admin approved is
 * public (slice 08b); the old `status` column is frozen and never read. Pass the table alias when the query joins
 * or uses a subselect. This is the single switch for the home list, link previews, the map bundle and the map repos.
 */
export const publishedEvent = (alias?: string): string => `${alias ? `${alias}.` : ""}publish_state = 'published'`;
