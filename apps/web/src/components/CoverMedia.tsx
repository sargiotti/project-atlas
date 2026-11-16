import { useState, type CSSProperties } from "react";
import { fallbackCoverGeometry, toneOf, type CoverImage } from "@atlas/contract";
import { focalCss } from "../lib/coverRules";
import "./cover.css";

/**
 * The colour cover (slice 14): tone fill, faint map grid, two pixel trails to the Atlas pin on a white tile.
 * Built as React/SVG elements from the contract's fixed geometry: no string-to-HTML step, nothing user-controlled.
 * The pin stays centred at every ratio (`slice`), so it also survives WhatsApp's square crop.
 */
export function FallbackCover({ tone }: { tone: number }) {
  const g = fallbackCoverGeometry(tone);
  return (
    <svg className="cv-fb" viewBox={g.viewBox} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <rect width="600" height="300" fill={g.background} />
      <path fill={g.grain.fill} d={g.grain.d} />
      <path fill={g.trail.fill} d={g.trail.d} shapeRendering="crispEdges" />
      <path fill={g.marks.fill} d={g.marks.d} shapeRendering="crispEdges" />
      <rect x={g.shadow.x} y={g.shadow.y} width={g.shadow.width} height={g.shadow.height} rx={g.shadow.rx} fill={g.shadow.fill} />
      <rect x={g.tile.x} y={g.tile.y} width={g.tile.width} height={g.tile.height} rx={g.tile.rx} fill={g.tile.fill} />
      <g transform={g.pin.transform} shapeRendering="crispEdges">
        {g.pin.layers.map((l, i) => <path key={i} fill={l.fill} d={l.d} />)}
      </g>
    </svg>
  );
}

/**
 * The cover of an event on any surface: the uploaded picture (`<img src>` from API URLs, CSS `object-position` from the
 * numeric focal point) or, when there is none or it fails to load (e.g. replaced after the list was cached), the colour cover.
 * `size`: "card" uses only the 800 px file; "full" the full file. The picture is decorative (the name follows it).
 */
export function CoverMedia({
  cover, tone, size, className, lazy, imgClassName,
}: { cover: CoverImage | null | undefined; tone: number; size: "card" | "full"; className?: string; lazy?: boolean; imgClassName?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  const src = cover ? (size === "card" ? cover.url800 : cover.url) : null;
  if (!cover || !src || broken === src) return <FallbackCover tone={tone} />;
  const style: CSSProperties = { objectPosition: focalCss(cover.focal) };
  return (
    <img
      className={imgClassName ?? className}
      src={src}
      width={size === "card" ? 800 : cover.width}
      height={size === "card" ? Math.round((800 * cover.height) / cover.width) : cover.height}
      alt=""
      style={style}
      loading={lazy === false ? "eager" : "lazy"}
      decoding="async"
      onError={() => setBroken(src)}
    />
  );
}

/** Tone of an organizer event from its id (not exposed publicly: visitors get `tone` from the API). */
export const toneForId = (id: string) => toneOf(id);

/** Header band of the "About the event" sheet (8:3). Uploaded cover or the colour cover. */
export function AboutCover({ cover, tone }: { cover?: CoverImage | null; tone?: number }) {
  return (
    <div className="cv-sheethd">
      <CoverMedia cover={cover} tone={tone ?? 0} size="full" imgClassName="cv-fill" />
    </div>
  );
}
