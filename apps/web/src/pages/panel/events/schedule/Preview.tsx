import { lazy, Suspense, useId, useMemo, useState } from "react";
import { addDays, type Point } from "@atlas/contract";
import { useI18n } from "../../../../i18n/I18nProvider";
import { withTimes } from "../../../../lib/schedule";
import { dayBegin } from "../../../../lib/scheduleTime";
import type { EditorSession } from "../../../../lib/scheduleModel";
import SessionsPanel from "../../../../components/SessionsPanel";
import { Ic } from "../common";

// The visitor grid is the heavy part of the preview: loaded only when "Whole day" is first opened.
const ScheduleView = lazy(() => import("../../../../components/ScheduleView"));

type Props = {
  event: { slug: string; name: string; timeZone: string; dayStart: string; startDate: string };
  places: Point[];
  place: Point | null;
  day: string;
  sessions: EditorSession[];
};

/**
 * "What visitors see" (AC14): the real visitor components, read-only, fed from the local (possibly unsaved) state.
 * "This place" = the Point sheet's session list; "Whole day" = the visitor schedule grid.
 */
export default function Preview({ event, places, place, day, sessions }: Props) {
  const { t } = useI18n();
  const uid = useId().replace(/:/g, "");
  const [mode, setMode] = useState<"place" | "day">("place");
  const [gridSeen, setGridSeen] = useState(false);
  const { timeZone, dayStart } = event;

  const timed = useMemo(
    () =>
      withTimes(
        sessions.map((s) => ({ id: s.key, pointId: s.pointId, title: s.title.trim() || "…", start: s.start, end: s.end, ...(s.description.trim() ? { description: s.description.trim() } : {}) })),
        timeZone,
        dayStart,
      ),
    [sessions, timeZone, dayStart],
  );
  const placeSessions = useMemo(() => (place ? timed.filter((s) => s.pointId === place.id) : []), [timed, place]);
  // A fixed "now" at the start of the open day: the first show reads as "Next", and no live clock runs in the editor.
  const atDay = dayBegin(day, dayStart, timeZone);
  // For the grid: a "now" long before the event, so no live line is drawn.
  const longBefore = dayBegin(addDays(event.startDate, -30), dayStart, timeZone);

  const pick = (m: "place" | "day") => {
    setMode(m);
    if (m === "day") setGridSeen(true);
  };

  return (
    <div className="sed-prev">
      <div className="sed-ph">
        <h2><Ic n="eye" size={16} />{t("sedPrevTitle")}</h2>
        <div className="seg" role="group" aria-label={t("sedPrevTitle")}>
          <button type="button" aria-pressed={mode === "place"} className={mode === "place" ? "on" : ""} onClick={() => pick("place")}>{t("sedPrevPlace")}</button>
          <button type="button" aria-pressed={mode === "day"} className={mode === "day" ? "on" : ""} onClick={() => pick("day")}>{t("sedPrevDay")}</button>
        </div>
      </div>
      <div className="sed-pb" id={`${uid}-b`}>
        {mode === "place" ? (
          place && placeSessions.length > 0 ? (
            <SessionsPanel key={`${place.id}:${day}`} point={place} event={event} sessions={placeSessions} atMs={atDay} focusDay={day} readOnly />
          ) : (
            <p className="sed-pnone">{place ? t("sedPrevNone") : t("sedPickS")}</p>
          )
        ) : timed.length === 0 ? (
          <p className="sed-pnone">{t("sedPrevNone")}</p>
        ) : (
          gridSeen && (
            <div className="sed-grid">
              <Suspense fallback={<p className="sed-pnone" role="status">{t("loading")}</p>}>
                <ScheduleView
                  key={day}
                  active
                  event={event}
                  points={places}
                  sessions={timed}
                  atMs={longBefore}
                  selectedSessionId={null}
                  sheetOpen={false}
                  revealNonce={0}
                  onPickSession={() => {}}
                  initialDay={day}
                />
              </Suspense>
            </div>
          )
        )}
      </div>
      <p className="sed-pf">{t("sedPrevFoot")}</p>
    </div>
  );
}
