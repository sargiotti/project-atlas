import type { ReactNode } from "react";
import { PINS } from "../../markers/categories";
import { CategoryIcon } from "../../markers/Pixel";

// Page art for /organizadores: pins, small pixel scenes and the phone mock. Constants only, nothing here comes from data.
const INK = "#1E2340";
const PAPER = "#FAF6EF";
const WHITE = "#FFFFFF";

export const MAP_DEMO = "/organizers/map-demo.webp";
/** Demo pins on the demo map (category, x, y as fractions of the image), same as the approved design. */
export const DEMO_POINTS: [string, number, number][] = [
  ["stage", 0.4937, 0.5197], ["food", 0.3125, 0.3023], ["food", 0.2645, 0.4905], ["drinks", 0.4149, 0.3295], ["drinks", 0.433, 0.8302],
  ["first-aid", 0.7201, 0.7269], ["info", 0.4665, 0.2785], ["entrance-exit", 0.0815, 0.3023], ["merch", 0.1857, 0.7948], ["landmark", 0.82, 0.31],
  ["toilets", 0.6, 0.62],
];

const rectsOf = (g: string[], c: number, ox: number, oy: number) =>
  g.flatMap((row, y) => [...row].map((ch, x) => (ch === "X" ? <rect key={`${x}-${y}`} x={ox + x * c} y={oy + y * c} width={c} height={c} /> : null)));

// Glyphs that only this page uses (benefit icons), on the same 8x8 grid as the point categories.
const EXTRA: Record<string, { head: "round" | "square"; body: string; glyph: string; g: string[] }> = {
  refresh: { head: "round", body: "#4CB8E8", glyph: INK, g: ["..XXXX.X", ".X....XX", "X....XXX", "X.......", ".......X", "XXX....X", "XX....X.", "X.XXXX.."] },
  lang: { head: "round", body: "#3FBF9B", glyph: INK, g: ["..XXXX..", ".X.XX.X.", "X..XX..X", "XXXXXXXX", "X..XX..X", "X..XX..X", ".X.XX.X.", "..XXXX.."] },
  free: { head: "round", body: "#FFC53D", glyph: INK, g: ["...XX...", "...XX...", "XXXXXXXX", ".XXXXXX.", "..XXXX..", ".XXXXXX.", ".XX..XX.", "X......X"] },
};

export function BenefitIcon({ kind, size = 40 }: { kind: "toilets" | "refresh" | "lang" | "free"; size?: number }) {
  if (kind === "toilets") return <CategoryIcon category="toilets" size={size} />;
  const p = EXTRA[kind];
  return (
    <svg className="px" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="11.25" fill={p.body} stroke={WHITE} strokeWidth="1.5" />
      <g fill={p.glyph} shapeRendering="crispEdges">{rectsOf(p.g, 1.5, 6, 6)}</g>
    </svg>
  );
}

const TAIL = "M15 38 L22 50 L29 38 Z";
function pinInner(category: string) {
  const pin = PINS[category];
  if (!pin) return null;
  const p = pin.light;
  const head = pin.head === "round" ? <circle cx="22" cy="21" r="20" /> : <rect x="2" y="1" width="40" height="40" rx="12" />;
  return (
    <>
      <g fill={p.ring} stroke={p.ring} strokeWidth="3" strokeLinejoin="round"><path d={TAIL} />{head}</g>
      <g fill={p.body}><path d={TAIL} />{head}</g>
      <g fill={p.glyph} shapeRendering="crispEdges">{rectsOf(pin.glyph, 3, 10, 9)}</g>
    </>
  );
}

/** HTML-level pin, width w px (tip at the bottom centre). */
export function PagePin({ category, w = 24 }: { category: string; w?: number }) {
  return (
    <svg className="px" width={w} height={(w * 56) / 48} viewBox="-2 -2 48 56" aria-hidden="true" focusable="false">{pinInner(category)}</svg>
  );
}

/** Pin inside an SVG scene, tip at (x, y). */
function ScenePin({ category, x, y, w = 18 }: { category: string; x: number; y: number; w?: number }) {
  return (
    <svg x={x - w / 2} y={y - (w * 52) / 48} width={w} height={(w * 56) / 48} viewBox="-2 -2 48 56" overflow="visible">{pinInner(category)}</svg>
  );
}

// ---- the phone with the real public map -------------------------------------------------------
export function Phone({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`org-phone ${className}`.trim()} aria-hidden="true">{children}</div>;
}

export function MapScreen({ name, labels, pw = 11, lazy }: { name: string; labels: [string, string, string]; pw?: number; lazy?: boolean }) {
  return (
    <div className="org-ms">
      <div className="org-ms-top"><svg viewBox="0 0 80 80" width="11" height="11" className="px"><use href="#org-pin" /></svg><span>{name}</span></div>
      <div className="org-ms-map">
        <div className="org-ms-in">
          <img src={MAP_DEMO} alt="" loading={lazy ? "lazy" : undefined} decoding="async" />
          {DEMO_POINTS.map(([c, x, y], i) => (
            <span key={i} className="org-mp" style={{ left: `${x * 100}%`, top: `${y * 100}%` }}><PagePin category={c} w={pw} /></span>
          ))}
        </div>
      </div>
      <div className="org-ms-sw"><span className="on">{labels[0]}</span><span>{labels[1]}</span><span>{labels[2]}</span></div>
    </div>
  );
}

/** SVG symbol of the wordmark pin (referenced with <use>). Rendered once by the page. */
export function PinSymbol() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        <symbol id="org-pin" viewBox="0 0 80 80">
          <g fill="#FF6A3D">
            <rect x="16" y="0" width="48" height="8" /><rect x="8" y="8" width="64" height="8" /><rect x="0" y="16" width="80" height="8" />
            <rect x="0" y="24" width="24" height="16" /><rect x="56" y="24" width="24" height="16" /><rect x="0" y="40" width="80" height="8" />
            <rect x="8" y="48" width="64" height="8" /><rect x="16" y="56" width="48" height="8" /><rect x="24" y="64" width="32" height="8" /><rect x="32" y="72" width="16" height="8" />
          </g>
          <rect x="24" y="24" width="32" height="16" fill="currentColor" />
        </symbol>
      </defs>
    </svg>
  );
}

// ---- use-case scenes (SVG on a 4 px grid) -----------------------------------------------------
class Scene {
  els: ReactNode[] = [];
  private n = 0;
  r(x: number, y: number, w: number, h: number, f: string) {
    this.els.push(<rect key={this.n++} x={x} y={y} width={w} height={h} fill={f} />);
  }
  add(node: ReactNode) {
    this.els.push(<g key={this.n++}>{node}</g>);
  }
  awn(x: number, y: number, w: number, a: string, b: string) {
    for (let i = 0; i < w; i += 4) this.r(x + i, y, 4, 6, (i / 4) % 2 ? b : a);
  }
  flag(x: number, y: number, f: string) {
    this.r(x, y, 6, 2, f);
    this.r(x + 1, y + 2, 4, 2, f);
    this.r(x + 2, y + 4, 2, 2, f);
  }
  crowd(x0: number, y0: number, cols: number, rows: number, seed = 1) {
    const C = [INK, "#FF6A3D", "#4CB8E8", "#3FBF9B", "#D63A84", "#FFC53D"];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if ((c * 7 + r * 3 + seed) % 5 === 0) continue;
        this.r(x0 + c * 6 + (r % 2) * 3, y0 + r * 5, 3, 3, C[(c + r * 2 + seed) % 6]);
      }
  }
  pin(category: string, x: number, y: number, w = 18) {
    this.els.push(<ScenePin key={this.n++} category={category} x={x} y={y} w={w} />);
  }
}

const SCENES: Record<string, () => ReactNode[]> = {
  fiestas() {
    const s = new Scene();
    s.r(0, 0, 160, 100, "#FFF3DC"); s.r(0, 70, 160, 30, "#F3E0BC");
    s.r(112, 44, 36, 38, "#FFE3B8"); s.r(120, 20, 16, 26, "#FFC53D"); s.r(124, 12, 8, 8, "#FF8A5C"); s.r(127, 4, 2, 8, INK); s.r(125, 6, 6, 2, INK);
    s.r(124, 28, 8, 8, "#8F2A0A"); s.r(124, 66, 10, 16, "#8F2A0A"); s.r(108, 40, 44, 6, "#FF6A3D");
    s.r(4, 44, 30, 32, "#FFD8C2"); s.r(2, 40, 34, 6, "#FF6A3D"); s.r(10, 52, 6, 8, "#4CB8E8"); s.r(22, 52, 6, 8, "#4CB8E8");
    s.r(42, 62, 26, 14, "#fff"); s.awn(42, 58, 26, "#FF6A3D", "#fff"); s.r(76, 62, 26, 14, "#fff"); s.awn(76, 58, 26, "#3FBF9B", "#fff");
    s.add(<path d="M0 10 Q80 26 160 8" stroke="#E5484D" strokeWidth="1" fill="none" />);
    [[14, "#4CB8E8"], [34, "#FFC53D"], [54, "#3FBF9B"], [74, "#FF6A3D"], [94, "#D63A84"], [138, "#4CB8E8"]].forEach(([x, f], i) =>
      s.flag(x as number, 12 + Math.round(Math.sin(i / 1.6 + 0.3) * 3 + 4), f as string));
    s.crowd(46, 82, 14, 3, 2); s.pin("stage", 60, 54, 20); s.pin("food", 88, 56, 20); s.pin("landmark", 128, 26, 20);
    return s.els;
  },
  musica() {
    const s = new Scene();
    s.r(0, 0, 160, 100, "#2A3160"); s.r(0, 64, 160, 36, "#3B4478");
    s.add(<><polygon points="56,22 30,70 50,70" fill="#FFC53D" opacity=".25" /><polygon points="104,22 130,70 110,70" fill="#4CB8E8" opacity=".25" /></>);
    s.r(44, 18, 72, 4, "#C9CDE0"); s.r(44, 18, 4, 46, "#C9CDE0"); s.r(112, 18, 4, 46, "#C9CDE0"); s.r(48, 44, 64, 20, "#FF6A3D"); s.r(48, 40, 64, 4, "#8F2A0A");
    s.r(50, 26, 10, 14, INK); s.r(100, 26, 10, 14, INK); s.r(52, 30, 6, 2, "#5B6078"); s.r(102, 30, 6, 2, "#5B6078");
    s.r(54, 22, 4, 4, "#FFC53D"); s.r(78, 22, 4, 4, "#FFF"); s.r(102, 22, 4, 4, "#4CB8E8");
    s.crowd(14, 68, 22, 5, 0); s.r(6, 40, 22, 24, "#5B6078"); s.r(6, 36, 22, 4, "#FFC53D");
    s.pin("stage", 80, 40, 20); s.pin("drinks", 17, 36); s.pin("first-aid", 146, 62);
    return s.els;
  },
  mercado() {
    const s = new Scene();
    s.r(0, 0, 160, 100, "#FFF3DC"); s.r(0, 46, 160, 10, "#F3E0BC"); s.r(0, 90, 160, 10, "#F3E0BC");
    for (let i = 0; i < 4; i++) {
      s.r(8 + i * 38, 24, 30, 18, "#fff"); s.awn(8 + i * 38, 18, 30, ["#FFC53D", "#4CB8E8", "#3FBF9B", "#FF6A3D"][i], "#fff");
      s.r(12 + i * 38, 32, 6, 6, ["#FF6A3D", "#3FBF9B", "#D63A84", "#FFC53D"][i]); s.r(22 + i * 38, 32, 6, 6, ["#3FBF9B", "#FFC53D", "#4CB8E8", "#D63A84"][i]);
    }
    for (let i = 0; i < 4; i++) { s.r(8 + i * 38, 68, 30, 18, "#fff"); s.awn(8 + i * 38, 62, 30, ["#D63A84", "#FF6A3D", "#FFC53D", "#4CB8E8"][i], "#fff"); }
    s.crowd(10, 48, 24, 2, 3); s.pin("merch", 23, 20); s.pin("food", 99, 64); s.pin("info", 137, 46);
    return s.els;
  },
  carrera() {
    const s = new Scene();
    s.r(0, 0, 160, 100, "#DDF1D9");
    s.add(<><path d="M8 84 H40 V56 H84 V28 H128 V60 H152" stroke="#F3E0BC" strokeWidth="12" fill="none" /><path d="M8 84 H40 V56 H84 V28 H128 V60 H152" stroke="#fff" strokeWidth="2" strokeDasharray="4 4" fill="none" /></>);
    s.r(14, 64, 4, 24, INK); s.r(38, 64, 4, 24, INK);
    for (let i = 0; i < 6; i++) { s.r(18 + i * 4, 64, 4, 4, i % 2 ? INK : "#fff"); s.r(18 + i * 4, 68, 4, 4, i % 2 ? "#fff" : INK); }
    s.r(88, 40, 6, 6, "#fff"); s.r(90, 46, 2, 8, "#5B6078");
    [[60, 52], [64, 52], [100, 24], [108, 24]].forEach(([x, y], i) => { s.r(x, y, 4, 4, ["#FF6A3D", "#4CB8E8", "#D63A84", "#FFC53D"][i]); s.r(x, y - 3, 4, 3, "#FFD8C2"); });
    s.r(120, 74, 20, 16, "#fff"); s.r(118, 72, 24, 4, "#E5484D");
    s.pin("entrance-exit", 28, 60); s.pin("drinks", 96, 34); s.pin("first-aid", 130, 70);
    return s.els;
  },
  congreso() {
    const s = new Scene();
    s.r(0, 0, 160, 100, "#EEF0F6"); s.r(6, 6, 64, 52, "#fff"); s.r(6, 6, 64, 4, "#5B3CC4"); s.r(14, 14, 48, 6, "#FF6A3D");
    for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) s.r(14 + c * 6, 26 + r * 7, 4, 4, "#C9CDE0");
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { s.r(80 + c * 26, 8 + r * 24, 22, 18, "#fff"); s.r(80 + c * 26, 8 + r * 24, 22, 4, ["#4CB8E8", "#3FBF9B", "#FFC53D", "#D63A84", "#FF6A3D"][(r * 3 + c) % 5]); }
    s.r(6, 66, 64, 28, "#fff"); s.r(14, 74, 22, 12, "#FFF0C7"); s.r(40, 74, 22, 12, "#D8F0FB"); s.crowd(84, 82, 11, 2, 4);
    s.pin("info", 25, 72); s.pin("stage", 38, 24); s.pin("drinks", 51, 72);
    return s.els;
  },
  escuela() {
    const s = new Scene();
    s.r(0, 0, 160, 100, "#FFF3DC"); s.r(0, 64, 160, 36, "#BFE6B5"); s.r(8, 72, 72, 24, "#A9DC9E"); s.r(8, 72, 72, 2, "#fff"); s.r(43, 72, 2, 24, "#fff");
    s.r(92, 26, 60, 40, "#FFD8C2"); s.r(88, 22, 68, 6, "#FF6A3D"); s.r(114, 10, 16, 14, "#FFE3B8"); s.r(118, 13, 8, 8, "#fff"); s.r(121, 14, 2, 4, INK); s.r(121, 17, 3, 1, INK);
    for (let i = 0; i < 4; i++) s.r(98 + i * 14, 34, 8, 8, "#4CB8E8");
    s.r(116, 50, 12, 16, "#8F2A0A"); s.r(86, 6, 2, 30, "#5B6078"); s.r(88, 6, 10, 4, "#FFC53D"); s.r(88, 10, 10, 3, "#E5484D");
    s.add(<path d="M8 16 Q40 26 76 14" stroke={INK} strokeWidth="1" fill="none" />);
    [[14, "#FF6A3D"], [30, "#3FBF9B"], [46, "#FFC53D"], [62, "#4CB8E8"]].forEach(([x, f], i) => s.flag(x as number, 18 + [0, 3, 3, 1][i], f as string));
    s.r(14, 44, 40, 18, "#fff"); s.awn(14, 40, 40, "#D63A84", "#fff"); s.crowd(18, 76, 9, 3, 5);
    s.pin("stage", 44, 70); s.pin("food", 34, 38); s.pin("first-aid", 122, 48);
    return s.els;
  },
};

export const SCENE_NAMES = ["fiestas", "musica", "mercado", "carrera", "congreso", "escuela"] as const;
export const Scenery = ({ name }: { name: (typeof SCENE_NAMES)[number] }) => (
  <svg className="org-ill px" viewBox="0 0 160 100" aria-hidden="true" focusable="false" shapeRendering="crispEdges">{SCENES[name]()}</svg>
);

/** Example points per use case (categories only; the labels are translated). */
export const UC_CATS: Record<(typeof SCENE_NAMES)[number], [string, string, string, string]> = {
  fiestas: ["stage", "food", "toilets", "landmark"],
  musica: ["stage", "food", "drinks", "first-aid"],
  mercado: ["merch", "food", "info", "toilets"],
  carrera: ["entrance-exit", "drinks", "info", "first-aid"],
  congreso: ["info", "stage", "merch", "drinks"],
  escuela: ["stage", "food", "toilets", "first-aid"],
};

export const PAPER_COLOR = PAPER;
