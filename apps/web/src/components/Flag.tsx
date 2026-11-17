import type { Lang } from "../i18n/messages";

// Hand-converted from design/assets/flags (static shapes only: no <style>, no data: URLs, no ids, no external refs).
const COMMON = { "aria-hidden": true, focusable: "false", preserveAspectRatio: "xMidYMid slice" } as const;

/** Decorative flag in a 21x14 slot. The language name next to it is the accessible label. */
export default function Flag({ lang }: { lang: Lang }) {
  return (
    <span className="flag" aria-hidden="true">
      {lang === "ca" && (
        <svg viewBox="0 0 27 18" shapeRendering="crispEdges" {...COMMON}>
          <rect width="27" height="18" fill="#FCDD09" />
          <path fill="#DA121A" d="M0 2h27v2H0zM0 6h27v2H0zM0 10h27v2H0zM0 14h27v2H0z" />
        </svg>
      )}
      {lang === "da" && (
        <svg viewBox="0 0 37 28" shapeRendering="crispEdges" {...COMMON}>
          <rect width="37" height="28" fill="#C8102E" />
          <path fill="#FFFFFF" d="M12 0h4v28h-4zM0 12h37v4H0z" />
        </svg>
      )}
      {lang === "en" && (
        <svg viewBox="0 0 60 30" {...COMMON}>
          <rect width="60" height="30" fill="#012169" />
          <path d="M0 0L60 30M60 0L0 30" stroke="#FFFFFF" strokeWidth="6" />
          <path fill="#C8102E" d="M60 30L60 27.76 34.47 15 30 15ZM0 2.24L25.53 15 30 15 0 0ZM0 30L4.47 30 30 17.24 30 15ZM55.53 0L30 12.76 30 15 60 0Z" />
          <path d="M30 0v30M0 15h60" stroke="#FFFFFF" strokeWidth="10" />
          <path d="M30 0v30M0 15h60" stroke="#C8102E" strokeWidth="6" />
        </svg>
      )}
      {lang === "es" && (
        <svg viewBox="0 0 30 20" shapeRendering="crispEdges" {...COMMON}>
          <rect width="30" height="20" fill="#AA151B" />
          <rect y="5" width="30" height="10" fill="#F1BF00" />
        </svg>
      )}
    </span>
  );
}
