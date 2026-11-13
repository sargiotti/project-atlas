/**
 * Worker responses do not get `_headers`, so the Worker sets its own. These must stay equal to the
 * `/*` block of apps/web/public/_headers (tests keep them in line).
 */
export const API_CSP =
  "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'";
export const HTML_CSP =
  "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'";
