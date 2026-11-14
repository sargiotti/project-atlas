/**
 * Every visitor-facing read of `events` must include this literal predicate (never a bound parameter, so
 * the partial index idx_events_published_start_slug applies). Drafts are never public. Pass the table
 * alias when the query joins or uses a subselect.
 */
export const publishedEvent = (alias?: string): string => `${alias ? `${alias}.` : ""}status = 'published'`;
