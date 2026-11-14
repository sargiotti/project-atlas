import { POINT_CATEGORIES } from "@atlas/contract";

// Category colours from design deliverable 02 (table "Point Category tokens").
// deep: label text on light UI. light: chip background on light UI, label text on dark UI.
export const CATEGORY_INFO: Record<string, { deep: string; light: string; base: string }> = {
  stage: { deep: "#74480F", light: "#FBE7A6", base: "#D29A35" },
  food: { deep: "#7E3B16", light: "#FBD3B0", base: "#D3733B" },
  drinks: { deep: "#17545F", light: "#C6EEF2", base: "#3A98A9" },
  merch: { deep: "#7A2B58", light: "#FAD3E7", base: "#C25D96" },
  toilets: { deep: "#2F3A80", light: "#D7DCFA", base: "#6371C6" },
  "first-aid": { deep: "#7D1F28", light: "#FBD0CF", base: "#C4434C" },
  info: { deep: "#3B3550", light: "#EFECF6", base: "#8A84A2" },
  landmark: { deep: "#4E4A12", light: "#EEEBC0", base: "#8F8A2E" },
  "entrance-exit": { deep: "#22552C", light: "#CDEDC4", base: "#4B9752" },
};

export { POINT_CATEGORIES };
