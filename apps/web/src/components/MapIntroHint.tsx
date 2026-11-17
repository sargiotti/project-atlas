import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { LogoMark } from "../markers/Pixel";

// A constant marker only ("1"): no timestamps, event ids or counters.
const KEY = "atlas.mapIntro.v1";
const MIN_HEIGHT = 460;

function alreadySeen() {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false; // storage unavailable: show again, no error
  }
}
function markSeen() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* ignore */
  }
}

/**
 * One-off pixel dialog box above the Map / List / Schedule switch (slice 22). Static, no timer. It goes away on the first
 * pointerdown anywhere (the tap still reaches its target), wheel, Escape, its close button, or a change of view, and only
 * then is the marker written. It never takes focus and never blocks the map.
 */
export default function MapIntroHint({ view, mapLoaded, sheetOpen, hasSchedule }: { view: string; mapLoaded: boolean; sheetOpen: boolean; hasSchedule: boolean }) {
  const { t } = useI18n();
  const [done, setDone] = useState(() => alreadySeen() || window.innerHeight < MIN_HEIGHT);
  const shown = useRef(false);
  const visible = !done && view === "map" && mapLoaded && !sheetOpen;

  const dismiss = useCallback(() => {
    markSeen();
    setDone(true);
  }, []);

  useEffect(() => {
    if (done) return;
    if (visible) shown.current = true;
    else if (shown.current) dismiss(); // view changed or a sheet opened while it was up
    else if (mapLoaded && sheetOpen) setDone(true); // a sheet was already open on arrival: skip it, keep it unseen
  }, [done, visible, mapLoaded, sheetOpen, dismiss]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("wheel", dismiss, { capture: true, passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("wheel", dismiss, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [visible, dismiss]);

  if (!visible) return null;
  return (
    <div className="map-hint" role="status">
      <div className="pb">
        <div className="pbi">
          <LogoMark size={20} />
          <p>{t(hasSchedule ? "viewHint3" : "viewHint2")}</p>
          <button type="button" className="hx" aria-label={t("viewHintClose")} onClick={dismiss}>
            <svg viewBox="0 0 7 7" width="14" height="14" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="M0 0h1v1H0zM6 0h1v1H6zM1 1h1v1H1zM5 1h1v1H5zM2 2h1v1H2zM4 2h1v1H4zM3 3h1v1H3zM2 4h1v1H2zM4 4h1v1H4zM1 5h1v1H1zM5 5h1v1H5zM0 6h1v1H0zM6 6h1v1H6z" />
            </svg>
          </button>
        </div>
      </div>
      <svg className="ptail" width="20" height="12" viewBox="0 0 5 3" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
        <path d="M0 0h5v1H0zM1 1h3v1H1zM2 2h1v1H2z" />
      </svg>
    </div>
  );
}
