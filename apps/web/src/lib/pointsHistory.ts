import type { EditorPoint } from "./pointsModel";

// Undo/redo for the editor: client-only, a stack of whole-array snapshots (the arrays are small and immutable).
export const HISTORY_LIMIT = 50;

export type HState = { points: EditorPoint[]; past: EditorPoint[][]; future: EditorPoint[][]; coalesce: string | null };
export type HAction =
  | { type: "apply"; fn: (p: EditorPoint[]) => EditorPoint[]; coalesce?: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; points: EditorPoint[] }
  | { type: "seal" };

export const initialHistory = (points: EditorPoint[]): HState => ({ points, past: [], future: [], coalesce: null });

export function historyReducer(s: HState, a: HAction): HState {
  switch (a.type) {
    case "apply": {
      const next = a.fn(s.points);
      if (next === s.points) return s;
      // Typing in a field or one drag is a single step: consecutive actions with the same key share one entry.
      if (a.coalesce && a.coalesce === s.coalesce) return { ...s, points: next };
      return { points: next, past: [...s.past, s.points].slice(-HISTORY_LIMIT), future: [], coalesce: a.coalesce ?? null };
    }
    case "undo":
      if (!s.past.length) return s;
      return { points: s.past[s.past.length - 1]!, past: s.past.slice(0, -1), future: [s.points, ...s.future], coalesce: null };
    case "redo":
      if (!s.future.length) return s;
      return { points: s.future[0]!, past: [...s.past, s.points], future: s.future.slice(1), coalesce: null };
    case "reset":
      return initialHistory(a.points);
    case "seal":
      return s.coalesce ? { ...s, coalesce: null } : s;
  }
}
