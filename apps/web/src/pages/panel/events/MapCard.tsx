import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { PanelMap } from "@atlas/contract";
import { setMapTheme, uploadMap, type MapFail, type MapMessageKey } from "../../../api/panelMap";
import { safeImageUrl } from "../../../api/mapBundle";
import { useI18n } from "../../../i18n/I18nProvider";
import type { MessageKey } from "../../../i18n/messages";
import { encodeMap, inspectImage, type Encoded, type Inspected } from "../../../lib/mapImage";
import { FILE_ACCEPT, type InputError } from "../../../lib/mapImageRules";
import { Link } from "../../../lib/router";
import { Dialog, Ic, type IconName } from "./common";

type Theme = "light" | "dark";
type Phase =
  | { k: "idle" }
  | { k: "prep"; name: string }
  | { k: "soft"; name: string; insp: Inspected }
  | { k: "up"; name: string; enc: Encoded; pct: number | null }
  | { k: "fail"; name: string; enc: Encoded; fail: Exclude<MapFail, { status: "aborted" | "unauthenticated" | "not_found" }>; at: number };

type Props = {
  eventId: string;
  map: PanelMap | null;
  onMap: (map: PanelMap) => void;
  onUnauthenticated: () => void;
  onNotFound: () => void;
  /** Re-read the event (e.g. the map was changed elsewhere) without remounting the card. */
  onReload?: () => void;
};

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** Icon + bold first line + text. `alert` messages are announced at once; the rest wait for the screen reader. */
function Msg({ kind, lead, children, id, alert }: { kind: "err" | "warn" | "info"; lead?: ReactNode; children?: ReactNode; id?: string; alert?: boolean }) {
  const icon: IconName = kind === "err" ? "warn" : kind === "warn" ? "tri" : "clock";
  return (
    <div className={`pe-mmsg ${kind}`} id={id} role={alert ? "alert" : undefined}>
      <Ic n={icon} />
      <div>
        {lead != null && <b dir="auto">{lead}</b>}
        {children}
      </div>
    </div>
  );
}

/** Event hub card: upload, replace and Map Theme of the event's map (slice 08a). Everything the browser can check is checked here for UX; the server re-checks. */
export default function MapCard({ eventId, map, onMap, onUnauthenticated, onNotFound, onReload }: Props) {
  const { t, lang } = useI18n();
  const uid = useId().replace(/:/g, "");
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [hardErr, setHardErr] = useState<{ name: string; err: InputError } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [confirm, setConfirm] = useState<{ name: string; enc: Encoded; soft: boolean } | null>(null);
  const [detected, setDetected] = useState<{ theme: Theme; ambiguous: boolean } | null>(null);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "fail">("idle");
  const [themeSel, setThemeSel] = useState<Theme | null>(null);
  const [announce, setAnnounce] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const run = useRef(0); // bumped on every new pick / cancel: stale async results are dropped
  const ctrl = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      ctrl.current?.abort();
    };
  }, []);

  // Per-minute 429: one tick a second until the button unlocks.
  const waiting = phase.k === "fail" && phase.fail.status === "rate_limited" && phase.fail.kind === "minute";
  useEffect(() => {
    if (!waiting) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waiting]);

  const sizeId = `${uid}-size`;
  const errId = `${uid}-err`;
  const busy = phase.k === "prep" || phase.k === "up";
  const shownTheme: Theme | null = map ? (themeSel ?? map.theme) : null;
  useEffect(() => setThemeSel(null), [map?.updatedAt, map?.theme]);

  const cancel = () => {
    run.current++;
    ctrl.current?.abort();
    setPhase({ k: "idle" });
  };

  const startUpload = async (name: string, enc: Encoded) => {
    const id = ++run.current;
    const c = new AbortController();
    ctrl.current = c;
    setPhase({ k: "up", name, enc, pct: 0 });
    const r = await uploadMap(eventId, { full: enc.full.blob, small: enc.small.blob, theme: enc.theme }, {
      signal: c.signal,
      onProgress: (p) => alive.current && run.current === id && setPhase((cur) => (cur.k === "up" ? { ...cur, pct: Math.min(100, Math.round(p * 100)) } : cur)),
    });
    if (!alive.current || run.current !== id) return;
    if (r.status === "ok") {
      setDetected({ theme: enc.theme, ambiguous: enc.ambiguous });
      setSaved("idle");
      setPhase({ k: "idle" });
      setAnnounce(t("peMapUploadedSr"));
      onMap(r.map);
    } else if (r.status === "aborted") setPhase({ k: "idle" });
    else if (r.status === "unauthenticated") onUnauthenticated();
    else if (r.status === "not_found") onNotFound();
    else {
      if (r.status === "error" && r.code === "map_changed") onReload?.();
      setPhase({ k: "fail", name, enc, fail: r, at: Date.now() });
    }
  };

  const encodeThenUpload = async (name: string, insp: Inspected, soft: boolean, id: number) => {
    setPhase({ k: "prep", name });
    const enc = await encodeMap(insp);
    if (!alive.current || run.current !== id) return;
    if ("error" in enc) {
      setPhase({ k: "idle" });
      setHardErr({ name, err: enc.error });
      return;
    }
    if (map) {
      setPhase({ k: "idle" });
      setConfirm({ name, enc: enc.value, soft });
    } else void startUpload(name, enc.value);
  };

  const pick = async (files: File[]) => {
    const file = files[0];
    if (!file || busy) return;
    const id = ++run.current;
    setHardErr(null);
    setAnnounce("");
    setNote(files.length > 1 ? t("peMapOneOnly", { name: file.name }) : null);
    setPhase({ k: "prep", name: file.name });
    const r = await inspectImage(file);
    if (!alive.current || run.current !== id) return;
    if ("error" in r) {
      setPhase({ k: "idle" });
      setHardErr({ name: file.name, err: r.error });
      return;
    }
    // Replacing: the soft warning rides in the confirm dialog ("Replace anyway"), no second step.
    if (r.value.soft && !map) setPhase({ k: "soft", name: file.name, insp: r.value });
    else await encodeThenUpload(file.name, r.value, r.value.soft, id);
  };

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = ""; // the same file can be picked again after a fix
    void pick(files);
  };

  const dropProps = {
    onDragOver: (e: DragEvent) => {
      if (busy) return;
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(false);
      void pick([...e.dataTransfer.files]);
    },
  };

  const chooseInput = (label: string, cls: string, icon = true) => (
    <>
      <input id={`${uid}-file`} type="file" className="pe-vh" accept={FILE_ACCEPT} onChange={onInput} aria-describedby={hardErr ? `${sizeId} ${errId}` : sizeId} aria-invalid={hardErr ? true : undefined} />
      <label htmlFor={`${uid}-file`} className={cls}>{icon && <Ic n="upload" />}{label}</label>
    </>
  );

  const errText = (e: InputError) => t(`peMap${cap(e.key)}` as MessageKey, { w: e.w ?? "", h: e.h ?? "" });
  const hardMsg = hardErr && (
    <Msg kind="err" lead={hardErr.name} id={errId} alert>{errText(hardErr.err)}</Msg>
  );

  // ---- pieces --------------------------------------------------------------------------------------
  const head = (
    <div className="pe-mhead">
      <h2 className="pe-ctitle" id={`${uid}-h`}><Ic n="map" size={16} />{t("peMapTitle")}</h2>
      {map ? <span className="pe-mstep done"><Ic n="check" size={14} />{t("peStep1Done")}</span> : <span className="pe-mstep">{t("peStep2Now")}</span>}
    </div>
  );
  const fileRow = (name: string, dims: string) => (
    <div className="pe-mfile">
      <span className="pe-mnew" style={{ width: 52, height: 69, borderRadius: 10 }}><Ic n="map" size={20} /></span>
      <div>
        <p className="n" title={name} dir="auto">{name}</p>
        <p className="d">{dims}</p>
      </div>
    </div>
  );
  const progress = (lead: string, step: number, pct: number | null, sub: string) => (
    <div className="pe-mprog" role="progressbar" aria-label={lead} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-valuetext={pct == null ? lead : `${pct}%`}>
      <div className="r">
        <b>{lead}</b>
        <span>{t("peMapStep", { n: step })}{pct != null ? ` · ${pct}%` : ""}</span>
      </div>
      <div className={"pe-mbar" + (pct == null ? " ind" : "")}><i style={pct != null ? { width: `${pct}%` } : undefined} /></div>
      <small>{sub}</small>
    </div>
  );

  // ---- phases --------------------------------------------------------------------------------------
  let body: ReactNode;
  if (phase.k === "prep") {
    body = (
      <>
        {fileRow(phase.name, "")}
        {progress(t("peMapPreparing"), 1, null, t("peMapPreparingS"))}
        <div className="pe-mrow"><button type="button" className="btn sm ghost" onClick={cancel}>{t("cancel")}</button></div>
      </>
    );
  } else if (phase.k === "up") {
    body = (
      <>
        {fileRow(phase.name, t("peMapReady", { w: phase.enc.full.width, h: phase.enc.full.height }))}
        {progress(t("peMapUploading"), 2, phase.pct, t("peMapKeepOpen"))}
        <div className="pe-mrow"><button type="button" className="btn sm ghost" onClick={cancel}>{t("cancel")}</button></div>
      </>
    );
  } else if (phase.k === "soft") {
    const { insp, name } = phase;
    body = (
      <>
        {fileRow(name, `${insp.width} × ${insp.height} px`)}
        <Msg kind="warn" lead={t("peMapSoftT")}>{t("peMapSoftS")}</Msg>
        <div className="pe-acts" style={{ marginTop: 0 }}>
          <button type="button" className="btn" onClick={() => { run.current++; if ("close" in insp.bitmap) insp.bitmap.close(); setPhase({ k: "idle" }); }}>{t("peMapChooseOther")}</button>
          <button type="button" className="btn primary" autoFocus onClick={() => void encodeThenUpload(name, insp, true, ++run.current)}>{t("peMapUseAnyway")}</button>
        </div>
      </>
    );
  } else {
    // idle or fail: the map (or the empty drop zone), with the failure on top
    body = (
      <>
        {phase.k === "fail" && <FailBlock phase={phase} replacing={!!map} now={now} onRetry={() => void startUpload(phase.name, phase.enc)} onDismiss={() => setPhase({ k: "idle" })} chooseInput={chooseInput} />}
        {(phase.k === "idle" || map) && (map ? Uploaded() : phase.k === "idle" && Empty())}
      </>
    );
  }

  function Empty() {
    return (
      <>
        <div className={"pe-mdrop" + (over ? " over" : "") + (hardErr ? " bad" : "")} {...dropProps}>
          {hardMsg}
          {!hardErr && (
            <svg className="pe-mart" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
              <rect x="1" y="3" width="14" height="11" fill="#fff8ec" /><rect x="1" y="3" width="14" height="1" fill="#2f2a4f" /><rect x="1" y="13" width="14" height="1" fill="#2f2a4f" />
              <rect x="1" y="3" width="1" height="11" fill="#2f2a4f" /><rect x="14" y="3" width="1" height="11" fill="#2f2a4f" /><rect x="5" y="4" width="1" height="9" fill="#b9a8f0" />
              <rect x="10" y="4" width="1" height="9" fill="#b9a8f0" /><rect x="2" y="9" width="3" height="3" fill="#b5db7a" /><rect x="11" y="5" width="3" height="2" fill="#b5db7a" />
              <rect x="6" y="6" width="4" height="1" fill="#6f55c8" /><rect x="8" y="7" width="1" height="3" fill="#6f55c8" /><rect x="7" y="9" width="3" height="1" fill="#6f55c8" />
              <rect x="11" y="9" width="2" height="2" fill="#6f55c8" /><rect x="11" y="0" width="3" height="1" fill="#6f55c8" /><rect x="12" y="1" width="1" height="1" fill="#6f55c8" />
            </svg>
          )}
          <p className="t">{over ? t("peMapDrop") : hardErr ? "" : t("peMapUpload")}</p>
          {!over && (
            <>
              {!hardErr && <p className="s">{t("peMapDrag")}</p>}
              {chooseInput(hardErr ? t("peMapChooseAnother") : t("peMapChoose"), "btn primary lg")}
            </>
          )}
          <p className="pe-mhint" id={sizeId}>{t("peMapHint")}</p>
        </div>
        {note && <p className="pe-mnote" role="status">{note}</p>}
        <details className="pe-mtip">
          <summary><Ic n="info" size={18} />{t("peMapTip")}<span className="chev"><Ic n="chev" size={18} /></span></summary>
          <ul>
            {(["peMapTipCanva", "peMapTipVector", "peMapTipPdf"] as const).map((k) => {
              const [lead, ...rest] = t(k).split(/:\s/);
              return rest.length ? <li key={k}><b>{lead}:</b> {rest.join(": ")}</li> : <li key={k}>{lead}</li>;
            })}
          </ul>
        </details>
      </>
    );
  }

  function Uploaded() {
    if (!map || !shownTheme) return null;
    const thumb = safeImageUrl(map.small.url);
    const cardArt = thumb ? { backgroundImage: `url("${thumb}")` } : undefined;
    const when = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(map.updatedAt));
    const card = (v: Theme) => (
      <label className="pe-mtc" key={v}>
        <input
          type="radio"
          name={`${uid}-theme`}
          value={v}
          checked={shownTheme === v}
          onClick={() => setDetected((d) => (d ? { ...d, ambiguous: false } : d))}
          onChange={() => void changeTheme(v)}
        />
        <span className="art" style={cardArt}>
          <span className={`tok ${v}`}><Ic n="tent" size={16} /></span>
          <span className={`tok sq ${v}`}><Ic n="food" size={16} /></span>
          {detected?.theme === v && <span className="pe-mauto">{t("peMapAuto")}</span>}
        </span>
        <span className="chk"><Ic n="check" size={16} /></span>
        <span className="lbl">
          <b>{v === "light" ? t("peMapThemeLight") : t("peMapThemeDark")}</b>
          <small>{v === "light" ? t("peMapThemeLightS") : t("peMapThemeDarkS")}</small>
        </span>
      </label>
    );
    return (
      <div className="pe-mdone">
        {thumb && (
          <Link to={`/panel/events/${eventId}/preview`} className="pe-mthumb" aria-label={t("peMapSeePreview")}>
            <img src={thumb} alt={t("peMapAlt")} width={map.small.width} height={map.small.height} />
            <span className="zoom"><Ic n="eye" size={14} />{t("pePreview")}</span>
          </Link>
        )}
        <div className="pe-minfo">
          {hardErr && (
            <Msg kind="err" lead={t("peMapReplFailT")} id={errId} alert>
              <span dir="auto">{hardErr.name}: </span>{errText(hardErr.err)} {t("peMapReplFailS")}
            </Msg>
          )}
          {note && <p className="pe-mnote" role="status">{note}</p>}
          <div>
            <p className="pe-big">{t("peMapDone")}</p>
            <p className="pe-mmeta">
              <span><b>{map.full.width} × {map.full.height} px</b></span>
              <span>{t("peMapUpdated", { date: when })}</span>
            </p>
          </div>
          <div className="pe-mrow">
            <input id={`${uid}-file`} type="file" className="pe-vh" accept={FILE_ACCEPT} onChange={onInput} aria-describedby={hardErr ? `${sizeId} ${errId}` : sizeId} aria-invalid={hardErr ? true : undefined} />
            <label htmlFor={`${uid}-file`} className="btn sm"><Ic n="swap" size={18} />{t("peMapReplace")}</label>
            <Link to={`/panel/events/${eventId}/preview`} className="btn sm ghost"><Ic n="eye" size={18} />{t("peMapSeePreview")}</Link>
          </div>
          <p className="pe-mnote" id={sizeId}>{t("peMapHint")}</p>
          <fieldset className="pe-mtheme">
            <legend>
              {t("peMapTheme")}
              <span className="st" aria-live="polite">
                {saved === "saving" && t("peMapSaving")}
                {saved === "saved" && (<><Ic n="check" size={14} />{t("peMapSaved")}</>)}
              </span>
            </legend>
            <p className="help">{t("peMapThemeHelp")}</p>
            <div className="pe-mtc-row">{card("light")}{card("dark")}</div>
            {saved === "fail" && <Msg kind="err" lead={t("peMapThemeFail")} alert />}
          </fieldset>
          {detected?.ambiguous && <Msg kind="info" lead={t("peMapAmbT")}>{t("peMapAmbS")}</Msg>}
        </div>
      </div>
    );
  }

  const changeTheme = async (v: Theme) => {
    if (!map || v === shownTheme) return;
    setThemeSel(v);
    setSaved("saving");
    const r = await setMapTheme(eventId, v);
    if (!alive.current) return;
    if (r.status === "ok") {
      setSaved("saved");
      onMap(r.map);
    } else if (r.status === "unauthenticated") onUnauthenticated();
    else if (r.status === "not_found") onNotFound();
    else {
      setThemeSel(null); // back to what the server has
      setSaved("fail");
    }
  };

  const dlgId = `${uid}-dlg`;
  return (
    <section className="pe-hcardw pe-hmap" aria-labelledby={`${uid}-h`}>
      {head}
      {body}
      <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      {confirm && map && (
        <Dialog titleId={`${dlgId}-t`} descId={`${dlgId}-d`} initialFocus={() => document.getElementById(`${dlgId}-cancel`)} onClose={() => setConfirm(null)}>
          <div className="pe-dico"><Ic n="swap" size={24} /></div>
          <h2 id={`${dlgId}-t`}>{t("peMapReplT")}</h2>
          <p className="pe-dlgp" id={`${dlgId}-d`}>{t("peMapReplS")}</p>
          <div className="pe-mswap">
            <figure className="old">
              <img src={safeImageUrl(map.small.url) ?? undefined} alt="" />
              <span className="x"><Ic n="x" size={14} /></span>
              <span>{t("peMapCurrent")}</span>
            </figure>
            <span style={{ transform: "rotate(180deg)", color: "var(--ink-2)", display: "grid" }}><Ic n="left" size={22} /></span>
            <figure>
              <span className="pe-mnew"><Ic n="map" size={28} /></span>
              <span><b>{t("peMapNew")}</b> · {confirm.enc.full.width} × {confirm.enc.full.height} px</span>
            </figure>
          </div>
          {confirm.soft && <Msg kind="warn" lead={t("peMapSoftT")}>{t("peMapSoftS")}</Msg>}
          <div className="pe-acts">
            <button type="button" className="btn" id={`${dlgId}-cancel`} onClick={() => setConfirm(null)}>{t("cancel")}</button>
            <button type="button" className="btn primary" onClick={() => { const c = confirm; setConfirm(null); void startUpload(c.name, c.enc); }}>
              {confirm.soft ? t("peMapReplAnyway") : t("peMapReplBtn")}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

/** Server failure of an upload. The prepared file is kept: Try again re-sends it without redoing the work. */
function FailBlock({ phase, replacing, now, onRetry, onDismiss, chooseInput }: {
  phase: Extract<Phase, { k: "fail" }>;
  replacing: boolean;
  now: number;
  onRetry: () => void;
  onDismiss: () => void;
  chooseInput: (label: string, cls: string, icon?: boolean) => ReactNode;
}) {
  const { t, lang } = useI18n();
  const f = phase.fail;
  const retryNow = (
    <button type="button" className="btn primary" onClick={onRetry}><Ic n="swap" size={18} />{t("retry")}</button>
  );
  const name = (
    <div className="pe-mfile">
      <span className="pe-mnew" style={{ width: 52, height: 69, borderRadius: 10 }}><Ic n="map" size={20} /></span>
      <div>
        <p className="n" title={phase.name} dir="auto">{phase.name}</p>
        <p className="d">{t("peMapReady", { w: phase.enc.full.width, h: phase.enc.full.height })}</p>
      </div>
    </div>
  );

  if (f.status === "rate_limited") {
    const rel = new Intl.RelativeTimeFormat(lang, { numeric: "always" });
    const left = Math.max(0, Math.ceil(f.retryAfter - (now - phase.at) / 1000));
    const minute = f.kind === "minute";
    const when = minute ? rel.format(Math.max(1, Math.ceil(f.retryAfter / 60)), "minute") : rel.format(Math.max(1, Math.ceil(f.retryAfter / 3600)), "hour");
    return (
      <>
        {name}
        <Msg kind="info" lead={t(f.key as MessageKey)}>{t("peMapRetryIn", { rel: when })}</Msg>
        <div className="pe-mrow">
          {minute && left === 0 ? (
            retryNow
          ) : (
            <button type="button" className="btn" disabled aria-live="polite">
              {minute ? (<><Ic n="clock" size={18} />{t("peMapRetryCount", { "mm:ss": `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` })}</>) : t("peMapRetryLater")}
            </button>
          )}
          <button type="button" className="btn" onClick={onDismiss}>{t("cancel")}</button>
        </div>
      </>
    );
  }

  const key = f.key as MapMessageKey;
  // A rejected image or a changed event cannot be fixed by re-sending: only "choose another" / dismiss.
  const canRetry = f.retryable;
  let lead: string;
  let text: string | null;
  if (replacing) {
    lead = t("peMapReplFailT");
    text = `${t(key as MessageKey)} ${t("peMapReplFailS")}`;
  } else if (key === "peMapNetT") {
    lead = t("peMapNetT");
    text = t("peMapNetS");
  } else if (key === "peMapServerS") {
    lead = t("peMapNetT");
    text = t("peMapServerS");
  } else {
    lead = t(key as MessageKey);
    text = null;
  }
  return (
    <>
      {!replacing && name}
      <Msg kind="err" lead={lead} alert>{text}</Msg>
      <div className="pe-acts" style={{ marginTop: 0 }}>
        {replacing ? <button type="button" className="btn" onClick={onDismiss}>{t("cancel")}</button> : chooseInput(t("peMapChooseOther"), "btn", false)}
        {canRetry && retryNow}
      </div>
    </>
  );
}
