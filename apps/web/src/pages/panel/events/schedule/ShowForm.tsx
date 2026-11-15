import { useEffect, useId, useMemo, useRef, useState } from "react";
import { isInSessionWindow, utcToLocal, type SessionWindow } from "@atlas/contract";
import { useI18n } from "../../../../i18n/I18nProvider";
import { cpLen } from "../../../../lib/pointsModel";
import { SESSION_DESCRIPTION_MAX, SESSION_TITLE_MAX } from "../../../../lib/scheduleModel";
import {
  LENGTH_CHIPS, MIN_MS, dayBegin, dayEnd, findClash, minutesBetween, parseTypedTime, resolveEnd, resolveTime, suggestFixes,
  type Span,
} from "../../../../lib/scheduleTime";
import { dayLabel as dayChipLabel, durationLabel, weekdayShort } from "../../../../lib/schedule";
import { Ic } from "../common";

export type FormValue = { title: string; description: string; startMs: number; endMs: number };
export type Candidate = { startMs: number; endMs: number; bad: boolean };

export type FormProps = {
  mode: "add" | "edit";
  /** "S" = stage (shows), "L" = landmark (activities). */
  kind: "S" | "L";
  placeName: string;
  day: string;
  timeZone: string;
  dayStart: string;
  window: SessionWindow;
  /** The other sessions at this place (not the one being edited). */
  others: Span[];
  /** Sessions at this place / in the event, not counting the one being edited (the 150 / 1000 caps). */
  placeCount: number;
  eventCount: number;
  initial: { title: string; description: string; startText: string; endText: string | null; len: number };
  onSubmit: (v: FormValue, len: number) => void;
  onCancel?: () => void;
  onDelete?: () => void;
  onCandidate: (c: Candidate | null) => void;
  /** Bumps when Save was pressed: a name typed but not added shows the "not added yet" note. */
  savedTick: number;
  autoFocus?: boolean;
  nudge?: boolean;
};

const MAX_PER_POINT = 150;
const MAX_PER_EVENT = 1000;

/**
 * The show form (slice 13, deliverable 17 "the building block"). Forgiving typed times, length chips, Enter adds. All
 * text is plain text; the title is a single line. Overlaps are blocked inline, naming the clash, with up to two fixes.
 */
export default function ShowForm(p: FormProps) {
  const { t, lang } = useI18n();
  const uid = useId().replace(/:/g, "");
  const { mode, kind, day, timeZone, dayStart, window: win } = p;
  const [title, setTitle] = useState(p.initial.title);
  const [desc, setDesc] = useState(p.initial.description);
  const [showDesc, setShowDesc] = useState(!!p.initial.description);
  const [startText, setStartText] = useState(p.initial.startText);
  const [endText, setEndText] = useState(p.initial.endText ?? "");
  const [endMode, setEndMode] = useState<"len" | "typed">(p.initial.endText === null ? "len" : "typed");
  const [len, setLen] = useState(p.initial.len);
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [pendingNote, setPendingNote] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (p.autoFocus) titleRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (p.savedTick > 0 && mode === "add" && title.trim()) setPendingNote(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.savedTick]);
  useEffect(() => {
    if (!title.trim()) setPendingNote(false);
  }, [title]);

  const clock = (ms: number) => utcToLocal(ms, timeZone).time;
  const startTime = parseTypedTime(startText);
  const startMs = startTime ? resolveTime(day, startTime, dayStart, timeZone) : null;
  const startGap = !!startTime && startMs === null;

  // The end: from the length, or typed. An end earlier than the start means "the next morning".
  const calc = useMemo(() => {
    if (startMs === null) return { endMs: null as number | null, endErr: null as null | "missing" | "time" | "gap" | "equal" | "long" };
    if (endMode === "len") return { endMs: startMs + len * MIN_MS, endErr: null };
    const et = parseTypedTime(endText);
    if (!endText.trim()) return { endMs: null, endErr: "missing" as const };
    if (!et) return { endMs: null, endErr: "time" as const };
    const r = resolveEnd(startMs, day, et, dayStart, timeZone);
    if ("reason" in r) return { endMs: null, endErr: r.reason };
    return { endMs: (r as { ms: number }).ms, endErr: null };
  }, [startMs, endMode, len, endText, day, dayStart, timeZone]);
  const endMs = calc.endMs;
  const lenNow = startMs !== null && endMs !== null ? minutesBetween(startMs, endMs) : null;

  const outside = startMs !== null && !isInSessionWindow(startMs, win);
  const clash = startMs !== null && endMs !== null && !outside ? findClash(p.others, startMs, endMs) : null;
  const fixes = useMemo(
    () => (clash && startMs !== null && endMs !== null ? suggestFixes(p.others, startMs, endMs, clash, dayBegin(day, dayStart, timeZone), dayEnd(day, dayStart, timeZone)) : []),
    [clash, startMs, endMs, p.others, day, dayStart, timeZone],
  );

  const bad = outside || !!clash || endMs === null || startMs === null;
  const onCandidate = p.onCandidate;
  useEffect(() => {
    if (startMs !== null && endMs !== null) onCandidate({ startMs, endMs, bad: !!clash || outside });
    else onCandidate(null);
    return () => onCandidate(null);
  }, [startMs, endMs, clash, outside, onCandidate]);

  const cleanTitle = title.normalize("NFC").trim();
  const titleLen = cpLen(title);
  const descLen = cpLen(desc);
  const show = (f: string) => attempted || touched[f];

  const titleErr = titleLen > SESSION_TITLE_MAX ? t("sedErrNameLong") : show("title") && !cleanTitle ? t("sedErrName") : null;
  const startErr = startGap
    ? t("sedErrGap")
    : outside
      ? t("sedErrOutside")
      : show("start") && !startText.trim()
        ? t("sedErrStartMissing")
        : show("start") && !startTime
          ? startText.trim() ? t("sedErrTime") : null
          : null;
  const endErr =
    endMode === "len"
      ? null
      : calc.endErr === "gap"
        ? t("sedErrGap")
        : calc.endErr === "equal"
          ? t("sedErrEqual")
          : calc.endErr === "long"
            ? t("sedErrLong")
            : calc.endErr === "time" && show("end")
              ? t("sedErrTime")
              : calc.endErr === "missing" && show("end")
                ? t("sedErrEndMissing")
                : null;
  const descErr = descLen > SESSION_DESCRIPTION_MAX ? t("sedErrDescLong") : null;
  const limitErr =
    mode === "add" && p.placeCount >= MAX_PER_POINT ? t(`sedErrLimitPoint${kind}` as any) : mode === "add" && p.eventCount >= MAX_PER_EVENT ? t(`sedErrLimitEvent${kind}` as any) : null;

  const submit = () => {
    setAttempted(true);
    if (limitErr) return;
    if (!cleanTitle || titleLen > SESSION_TITLE_MAX) return void titleRef.current?.focus();
    if (startMs === null) return void startRef.current?.focus();
    if (endMs === null) return void (endMode === "typed" ? endRef.current : startRef.current)?.focus();
    if (descLen > SESSION_DESCRIPTION_MAX) return void descRef.current?.focus();
    if (outside || clash) return; // the reason is already on screen, with its fixes
    p.onSubmit({ title: cleanTitle, description: desc, startMs, endMs }, lenNow ?? len);
    if (mode === "add") {
      // The next one starts where this one ends and keeps its length.
      const nextStart = endMs <= dayEnd(day, dayStart, timeZone) ? clock(endMs) : "";
      setTitle("");
      setDesc("");
      setShowDesc(false);
      setStartText(nextStart);
      setEndMode("len");
      setLen(lenNow ?? len);
      setAttempted(false);
      setTouched({});
      setPendingNote(false);
      titleRef.current?.focus();
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && (e.target as HTMLElement).tagName !== "TEXTAREA" && (e.target as HTMLElement).tagName !== "BUTTON") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && mode === "edit" && p.onCancel) {
      e.preventDefault();
      p.onCancel();
    }
  };

  const normalize = (which: "start" | "end") => {
    setTouched((s) => ({ ...s, [which]: true }));
    const raw = which === "start" ? startText : endText;
    const parsed = parseTypedTime(raw);
    if (parsed && parsed !== raw) which === "start" ? setStartText(parsed) : setEndText(parsed);
  };

  const pickLen = (m: number) => {
    setLen(m);
    setEndMode("len");
  };
  const applyFix = (f: { startMs: number; endMs: number }) => {
    setStartText(clock(f.startMs));
    setEndMode("len");
    setLen(minutesBetween(f.startMs, f.endMs));
  };

  // After-midnight and next-morning notes, in words.
  const startDate = startMs !== null ? utcToLocal(startMs, timeZone).date : null;
  const afterMidnight = startDate !== null && startDate !== day;
  const endDate = endMs !== null ? utcToLocal(endMs, timeZone).date : null;
  const endsNextMorning = endMs !== null && startDate !== null && endDate !== null && endDate > (afterMidnight ? startDate : day) && clock(endMs) >= dayStart;

  const dayLabel = dayChipLabel(day, lang);
  const endShown = endMode === "len" ? (endMs !== null ? clock(endMs) : "") : endText;
  const whenNoun = (k: "S" | "L") => (k === "S" ? t("sedAddS") : t("sedAddL"));
  const clashId = `${uid}-clash`;

  return (
    <form className={`sed-form${p.nudge ? " nudge" : ""}`} onSubmit={(e) => e.preventDefault()} onKeyDown={onKey} aria-labelledby={`${uid}-h`} noValidate>
      <div className="fhead">
        <b id={`${uid}-h`}>{mode === "add" ? t(`sedFormNew${kind}` as any) : t(`sedFormEdit${kind}` as any)}</b>
        <span className="fs" dir="auto">{t("sedFormAt", { place: p.placeName, day: dayLabel })}</span>
      </div>

      <div className={`ped-fld${titleErr ? " bad" : ""}`}>
        <label htmlFor={`${uid}-title`}>
          <span>{t(`sedName${kind}` as any)}</span>
          {titleLen >= 100 && <small className={titleLen > SESSION_TITLE_MAX ? "over" : ""}>{titleLen} / {SESSION_TITLE_MAX}</small>}
        </label>
        <input
          id={`${uid}-title`}
          ref={titleRef}
          value={title}
          dir="auto"
          autoComplete="off"
          spellCheck={false}
          placeholder={t(`sedNamePh${kind}` as any)}
          aria-invalid={!!titleErr}
          aria-describedby={`${uid}-te`}
          onChange={(e) => setTitle(e.target.value.replace(/[\r\n]+/g, " "))}
          onBlur={() => setTouched((s) => ({ ...s, title: true }))}
        />
        <div id={`${uid}-te`} className="ped-fhint">{titleErr && <span className="err" role="alert">{titleErr}</span>}</div>
      </div>

      <div className="trow">
        <div className={`ped-fld ftime${startErr ? " bad" : ""}${clash ? " clash" : ""}`}>
          <label htmlFor={`${uid}-start`}><span>{t("sedStarts")}</span></label>
          <input
            id={`${uid}-start`}
            ref={startRef}
            value={startText}
            inputMode="numeric"
            autoComplete="off"
            placeholder={t("sedTimePh")}
            aria-invalid={!!startErr}
            aria-describedby={`${uid}-se ${clashId}`}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setStartText(e.target.value)}
            onBlur={() => normalize("start")}
          />
        </div>
        <span className="dash" aria-hidden="true">–</span>
        <div className={`ped-fld ftime${endErr ? " bad" : ""}${clash ? " clash" : ""}`}>
          <label htmlFor={`${uid}-end`}><span>{t("sedEnds")}</span></label>
          <input
            id={`${uid}-end`}
            ref={endRef}
            value={endShown}
            inputMode="numeric"
            autoComplete="off"
            placeholder={t("sedTimePh")}
            aria-invalid={!!endErr}
            aria-describedby={`${uid}-ee ${clashId}`}
            onChange={(e) => {
              setEndMode("typed");
              setEndText(e.target.value);
            }}
            onFocus={(e) => {
              if (endMode === "len") setEndText(endMs !== null ? clock(endMs) : "");
              e.target.select();
            }}
            onBlur={() => normalize("end")}
          />
        </div>
        <div className="lens" role="group" aria-label={t("sedLengthLbl")}>
          <span aria-hidden="true">{t("sedLengthLbl")}</span>
          {LENGTH_CHIPS.map((m) => (
            <button key={m} type="button" className={lenNow === m ? "on" : ""} aria-pressed={lenNow === m} onClick={() => pickLen(m)}>
              {durationLabel(m, t("unitH"))}
            </button>
          ))}
        </div>
      </div>
      <div id={`${uid}-se`} className="ped-fhint">{startErr && <span className="err" role="alert">{startErr}</span>}</div>
      <div id={`${uid}-ee`} className="ped-fhint">{endErr && <span className="err" role="alert">{endErr}</span>}</div>

      <div className="tinfo" aria-live="polite">
        {lenNow !== null && lenNow > 0 && (
          <span>
            <b>{t("sedLength", { len: durationLabel(lenNow, t("unitH")) })}</b>
            {afterMidnight && startDate && <> · {t("sedAfterMid", { date: dayChipLabel(startDate, lang), weekday: weekdayShort(day, lang) })}</>}
            {endsNextMorning && endMs !== null && <> · {t("sedEndsNext", { time: clock(endMs) })}</>}
          </span>
        )}
      </div>

      <div id={clashId} className="conf" role={attempted ? "alert" : undefined} aria-live={attempted ? undefined : "polite"}>
        {clash && (
          <>
            <p>
              <Ic n="warn" size={18} />
              <span dir="auto">
                {t(`sedClash${kind}` as any, { title: clash.title, start: clock(clash.startMs), end: clock(clash.endMs), place: p.placeName })}
              </span>
            </p>
            {fixes.length > 0 && (
              <div className="fx">
                {fixes.map((f) => (
                  <button key={`${f.kind}${f.startMs}`} type="button" onClick={() => applyFix(f)}>
                    {f.kind === "start" ? t("sedFixStart", { time: clock(f.startMs) }) : t("sedFixFree", { a: clock(f.startMs), b: clock(f.endMs) })}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {showDesc ? (
        <div className={`ped-fld${descErr ? " bad" : ""}`}>
          <label htmlFor={`${uid}-desc`}>
            <span>{t("sedDescLbl")}</span>
            {descLen >= 250 && <small className={descLen > SESSION_DESCRIPTION_MAX ? "over" : ""}>{descLen} / {SESSION_DESCRIPTION_MAX}</small>}
          </label>
          <textarea
            id={`${uid}-desc`}
            ref={descRef}
            value={desc}
            dir="auto"
            rows={3}
            placeholder={t("sedDescPh")}
            aria-invalid={!!descErr}
            aria-describedby={`${uid}-de`}
            onChange={(e) => setDesc(e.target.value)}
          />
          <div id={`${uid}-de`} className="ped-fhint">{descErr && <span className="err" role="alert">{descErr}</span>}</div>
        </div>
      ) : (
        <button type="button" className="adddesc" onClick={() => setShowDesc(true)}>{t("sedAddDesc")}</button>
      )}

      {limitErr && <div className="ped-fhint"><span className="err" role="alert">{limitErr}</span></div>}
      {pendingNote && <div className="pend" role="status">{t(`sedNotAdded${kind}` as any)}</div>}

      <div className="facts">
        {mode === "add" ? (
          <>
            <span className="kb">{t("sedEnterHint")}</span>
            <span className="sp" />
            <button type="button" className="btn primary" onClick={submit} disabled={!!limitErr} aria-describedby={bad && attempted ? clashId : undefined}>
              <Ic n="plus" size={18} />{whenNoun(kind)}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn danger" onClick={p.onDelete}><Ic n="trash" size={18} />{t("sedDelete")}</button>
            <span className="sp" />
            <button type="button" className="btn" onClick={p.onCancel}>{t("cancel")}</button>
            <button type="button" className="btn primary" onClick={submit}><Ic n="check" size={18} />{t("sedDone")}</button>
          </>
        )}
      </div>
    </form>
  );
}
