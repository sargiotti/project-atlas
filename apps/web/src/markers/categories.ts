import { POINT_CATEGORIES } from "@atlas/contract";

// Category colours and pin art from design deliverable 19 (brand adoption) and design/atlas-brand-handoff.md section 3.
// Constants only: nothing here comes from data.
// deep: label text on light UI. light: chip background on light UI, label text on dark UI. base: the pin body (light map).
export const CATEGORY_INFO: Record<string, { deep: string; light: string; base: string }> = {
  stage: { deep: "#8F2A0A", light: "#FFE0D4", base: "#FF6A3D" },
  food: { deep: "#7A5600", light: "#FFF0C7", base: "#FFC53D" },
  drinks: { deep: "#0F5F85", light: "#D8F0FB", base: "#4CB8E8" },
  merch: { deep: "#8E1B54", light: "#FADCEB", base: "#D63A84" },
  toilets: { deep: "#1E2340", light: "#E4E6EE", base: "#1E2340" },
  "first-aid": { deep: "#A8181E", light: "#FCDADB", base: "#E5484D" },
  info: { deep: "#17604B", light: "#D3F3EA", base: "#3FBF9B" },
  landmark: { deep: "#43299B", light: "#E5DFFA", base: "#5B3CC4" },
  "entrance-exit": { deep: "#1D4D98", light: "#D8E6FA", base: "#2F6FD0" },
};

type PinPaint = { body: string; glyph: string; ring: string };
export type PinSpec = { head: "round" | "square"; light: PinPaint; dark: PinPaint; glyph: string[] };

const INK = "#1E2340";
const PAPER = "#FAF6EF";
const WHITE = "#FFFFFF";
const same = (body: string, glyph: string, ring = WHITE): { light: PinPaint; dark: PinPaint } => ({ light: { body, glyph, ring }, dark: { body, glyph, ring } });

// 8x8 glyphs (X = pixel on). Round head = thing to do, square head = service. "light"/"dark" = Map Theme.
export const PINS: Record<string, PinSpec> = {
  stage: { head: "round", ...same("#FF6A3D", INK), glyph: ["....XXX.", "....X.XX", "....X...", "....X...", "..XXX...", ".XXXX...", ".XXXX...", "..XX...."] },
  food: { head: "round", ...same("#FFC53D", INK), glyph: ["..XXXX..", ".XXXXXX.", "XXXXXXXX", "........", "XXXXXXXX", "........", "XXXXXXXX", ".XXXXXX."] },
  drinks: { head: "round", ...same("#4CB8E8", INK), glyph: ["........", "XXXXXX..", "XXXXXXXX", "XXXXXX.X", "XXXXXX.X", "XXXXXXXX", ".XXXX...", "........"] },
  merch: { head: "round", ...same("#D63A84", PAPER), glyph: ["XXX..XXX", "XXXXXXXX", "XXXXXXXX", ".XXXXXX.", ".XXXXXX.", ".XXXXXX.", ".XXXXXX.", "........"] },
  landmark: {
    head: "round",
    light: { body: "#5B3CC4", glyph: PAPER, ring: WHITE },
    dark: { body: "#E9E2FF", glyph: "#4B2FA8", ring: WHITE },
    glyph: ["..XXX...", "..XXXXX.", "..XXXXXX", "..XXXXX.", "..XXX...", "..X.....", "..X.....", ".XXX...."],
  },
  toilets: {
    head: "square",
    light: { body: INK, glyph: PAPER, ring: WHITE },
    dark: { body: PAPER, glyph: INK, ring: WHITE },
    glyph: ["...XX...", "...XX...", "........", "..XXXX..", ".XXXXXX.", "..XXXX..", "..X..X..", "..X..X.."],
  },
  info: { head: "square", ...same("#3FBF9B", INK), glyph: ["...XX...", "...XX...", "........", "..XXX...", "...XX...", "...XX...", "...XX...", "..XXXX.."] },
  "first-aid": {
    head: "square",
    light: { body: WHITE, glyph: "#E5484D", ring: INK },
    dark: { body: WHITE, glyph: "#E5484D", ring: WHITE },
    glyph: ["..XXXX..", "..XXXX..", "XXXXXXXX", "XXXXXXXX", "XXXXXXXX", "XXXXXXXX", "..XXXX..", "..XXXX.."],
  },
  "entrance-exit": { head: "square", ...same("#2F6FD0", PAPER), glyph: ["....XX..", "XXXXXXX.", "XXXXXXX.", "....XX..", "..XX....", ".XXXXXXX", ".XXXXXXX", "..XX...."] },
};

export { POINT_CATEGORIES };
