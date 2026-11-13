/**
 * SVG safety check. Map SVGs are served from the app origin, so a script inside one
 * would be XSS. Returns a list of human-readable violations (empty = safe).
 */
export function findSvgViolations(svg: string): string[] {
  const violations: string[] = [];
  const add = (cond: boolean, msg: string) => cond && violations.push(msg);

  add(/<\s*script\b/i.test(svg), "contains <script>");
  add(/<\s*foreignObject\b/i.test(svg), "contains <foreignObject>");
  add(/<\s*(iframe|embed|object|audio|video|animate|set)\b/i.test(svg), "contains an active/embedding element");
  add(/[\s"'/]on[a-z]+\s*=/i.test(svg), "contains an inline event handler (on*=)");
  add(/javascript\s*:/i.test(svg), "contains a javascript: URL");
  add(/<!\s*(DOCTYPE|ENTITY)/i.test(svg), "contains DOCTYPE/ENTITY");
  add(/@import\b/i.test(svg), "contains CSS @import");
  add(/url\(\s*["']?\s*(https?:|\/\/|data:)/i.test(svg), "contains an external or data: url()");

  // Any href / xlink:href must be a same-document fragment reference (#id).
  for (const m of svg.matchAll(/\b(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const value = (m[1] ?? m[2] ?? "").trim();
    if (!value.startsWith("#")) violations.push(`external href: ${value.slice(0, 60)}`);
  }
  return violations;
}

/** Returns the SVG's viewBox width/height, or null when missing or not a "0 0 W H" box. */
export function readViewBox(svg: string): { width: number; height: number } | null {
  const m = /<svg\b[^>]*\bviewBox\s*=\s*"([^"]*)"/i.exec(svg);
  if (!m?.[1]) return null;
  const parts = m[1].trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minX, minY, width, height] = parts as [number, number, number, number];
  if (minX !== 0 || minY !== 0) return null;
  return { width, height };
}
