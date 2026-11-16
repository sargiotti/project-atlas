import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { PanelCover } from "@atlas/contract";
import { deleteCover, patchFocal, putCover, type CoverFail, type CoverMessageKey, type CoverResult, type CoverUpload } from "../../../api/panelCover";
import { CoverMedia, FallbackCover } from "../../../components/CoverMedia";
import { useI18n } from "../../../i18n/I18nProvider";
import type { MessageKey } from "../../../i18n/messages";
import { encodeCover, inspectCover, loadStored, refocusOg, type Inspected } from "../../../lib/coverImage";
import { clearCoverHandoff, type CoverHandoff } from "../../../lib/coverHandoff";
import { CENTRE, COVER_ACCEPT, type Focal, type InputError } from "../../../lib/coverRules";
import { Dialog, Ic } from "./common";
import CoverPicker, { CropCanvas } from "./CoverPicker";
import "./cover-editor.css";

/** What the form keeps while the organizer picks: the decoded picture and the point. In memory only. */
export type CoverDraft = { bitmap: ImageBitmap; width: number; height: number; focal: Focal; name: string };

type Phase = "idle" | "checking" | "pick" | "saving";
type Src = { bitmap: ImageBitmap; width: number; height: number; name: string; mode: "new" | "stored" };
type Notice =
  | { kind: "input"; error: InputError; name: string }
  | { kind: "soft"; w: number }
  | { kind: "fail"; key: CoverMessageKey; retryAfter?: number }
  | { kind: "text"; text: string }
  | { kind: "ok" }
  | null;

function Alert({ kind, title, children, acts }: { kind: "err" | "warn" | "ok"; title: string; children?: ReactNode; acts?: ReactNode }) {
  return (
    <div className={`cv-alert ${kind === "err" ? "" : kind}`} role={kind === "ok" ? "status" : "alert"}>
      <Ic n={kind === "ok" ? "check" : "warn"} size={20} />
      <div>
        <b>{title}</b>
        {children && <span>{children}</span>}
        {acts && <div className="acts">{acts}</div>}
      </div>
    </div>
  );
}

const closeBitmap = (b?: ImageBitmap | null) => {
  try {
    b?.close();
  } catch {
    /* already closed */
  }
};

/** Message for a failed cover request, with the retry wait when there is one. */
function useFailText() {
  const { t } = useI18n();
  return (key: CoverMessageKey, retryAfter?: number) => t(key, { n: retryAfter ?? 0 });
}

/**
 * Section 5 of the event form: the optional cover. Pick first, upload on Save: choosing a file only opens the local focal
 * step. In the create form (no `eventId`) nothing is sent here: the parent creates the event once and then uploads the cover.
 * In the edit form it saves on its own ("Save cover"), replaces (the old cover stays until the new one is saved), changes only
 * the focal point (one small upload) or removes it (with confirmation).
 */
export default function CoverSection({
  eventId, eventName, tone, stored, published, sectionNumber, error, onStored, onDraft, onReload, onUnauthenticated, onNotFound, handoff, onHandoffDone,
}: {
  eventId?: string;
  eventName: string;
  tone: number;
  stored: PanelCover | null;
  published: boolean;
  sectionNumber: number;
  /** A cover problem found by the parent (create form: the browser couldn't prepare the files). */
  error?: { key: MessageKey } | null;
  onStored?: (c: PanelCover | null) => void;
  onDraft: (d: CoverDraft | null) => void;
  onReload?: () => void;
  onUnauthenticated?: () => void;
  onNotFound?: () => void;
  /** Create form went through but the upload failed: Try again / Skip, never a second create. */
  handoff?: CoverHandoff | null;
  onHandoffDone?: () => void;
}) {
  const { t } = useI18n();
  const failText = useFailText();
  const uid = useId().replace(/:/g, "");
  const creating = !eventId;
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const encoded = useRef<CoverUpload | null>(null); // reused by "Try again" while the point is unchanged
  const [phase, setPhase] = useState<Phase>("idle");
  const [src, setSrc] = useState<Src | null>(null);
  const [focal, setFocal] = useState<Focal>(CENTRE);
  const [notice, setNotice] = useState<Notice>(null);
  const [soft, setSoft] = useState<{ file: File; value: Inspected } | null>(null);
  const [progress, setProgress] = useState(0);
  const [over, setOver] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeFailed, setRemoveFailed] = useState(false);
  const [retry, setRetry] = useState<CoverHandoff | null>(handoff ?? null);
  const [retryBitmap, setRetryBitmap] = useState<ImageBitmap | null>(null);
  const srcRef = useRef<Src | null>(null);
  srcRef.current = src;

  // Tell the form what is being picked (create: it uploads it after creating the event; edit: live preview).
  useEffect(() => {
    onDraft(src && src.mode === "new" ? { bitmap: src.bitmap, width: src.width, height: src.height, focal, name: src.name } : null);
  }, [src, focal.x, focal.y]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nothing survives leaving the form: close the bitmaps, abort an upload in flight, drop the handoff.
  useEffect(() => {
    let alive = true;
    return () => {
      alive = false;
      abort.current?.abort();
      closeBitmap(srcRef.current?.bitmap);
      onDraft(null);
      setTimeout(() => {
        if (!alive) clearCoverHandoff();
      }, 0);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!retry) return;
    let off = false;
    Promise.resolve().then(() => createImageBitmap(retry.files.full)).then((b) => (off ? closeBitmap(b) : setRetryBitmap(b)), () => {});
    return () => {
      off = true;
    };
  }, [retry]);

  const reset = () => {
    closeBitmap(src?.bitmap);
    setSrc(null);
    setSoft(null);
    setPhase("idle");
    setFocal(CENTRE);
    encoded.current = null;
  };

  const openPick = (s: Src, f: Focal) => {
    closeBitmap(src?.bitmap);
    encoded.current = null;
    setSrc(s);
    setFocal(f);
    setSoft(null);
    setNotice(null);
    setPhase("pick");
  };

  const choose = async (file: File | undefined | null) => {
    if (!file || phase === "saving") return;
    setNotice(null);
    setSoft(null);
    setPhase("checking");
    const r = await inspectCover(file);
    if ("error" in r) {
      setPhase(src ? "pick" : "idle");
      setNotice({ kind: "input", error: r.error, name: file.name });
      return;
    }
    if (r.value.soft) {
      setSoft({ file, value: r.value });
      setNotice({ kind: "soft", w: r.value.width });
      setPhase(src ? "pick" : "idle");
      return;
    }
    openPick({ bitmap: r.value.bitmap, width: r.value.width, height: r.value.height, name: file.name, mode: "new" }, CENTRE);
  };

  const useAnyway = () => {
    if (!soft) return;
    const v = soft.value;
    openPick({ bitmap: v.bitmap, width: v.width, height: v.height, name: soft.file.name, mode: "new" }, CENTRE);
  };
  const otherImage = () => {
    closeBitmap(soft?.value.bitmap);
    setSoft(null);
    setNotice(null);
    input.current?.click();
  };

  const pickStored = async () => {
    if (!stored) return;
    setNotice(null);
    setPhase("checking");
    const b = await loadStored(stored.url);
    if (!b) {
      setPhase("idle");
      setNotice({ kind: "text", text: t("cvErrStored") });
      return;
    }
    openPick({ bitmap: b, width: b.width, height: b.height, name: "", mode: "stored" }, stored.focal);
  };

  const onFail = (r: CoverFail) => {
    if (r.status === "unauthenticated") return onUnauthenticated?.();
    if (r.status === "not_found") return onNotFound?.();
    if (r.status === "aborted") {
      setPhase(srcRef.current ? "pick" : "idle");
      return;
    }
    setPhase(srcRef.current ? "pick" : "idle");
    setNotice({ kind: "fail", key: r.key, retryAfter: r.status === "rate_limited" ? r.retryAfter : undefined });
    if (r.status === "error" && r.key === "cvFailChanged") onReload?.();
  };

  const finish = (r: Extract<CoverResult, { status: "ok" }>) => {
    reset();
    setProgress(0);
    setNotice({ kind: "ok" });
    onStored?.(r.cover);
  };

  const save = async () => {
    if (!eventId || !src || phase === "saving") return;
    setNotice(null);
    setProgress(0);
    setPhase("saving");
    const ctl = new AbortController();
    abort.current = ctl;
    if (src.mode === "stored") {
      const og = await refocusOg(src.bitmap, focal);
      if (!og) {
        setPhase("pick");
        return setNotice({ kind: "text", text: t("cvErrEncode") });
      }
      const r = await patchFocal(eventId, { og, fx: focal.x, fy: focal.y, baseVersion: stored?.version ?? "" }, { onProgress: setProgress, signal: ctl.signal });
      return r.status === "ok" ? finish(r) : onFail(r);
    }
    let files = encoded.current;
    if (!files) {
      const enc = await encodeCover(src.bitmap, focal);
      if (!enc.ok) {
        setPhase("pick");
        return setNotice({ kind: "text", text: t("cvErrEncode") });
      }
      files = encoded.current = { full: enc.value.full, small: enc.value.small, og: enc.value.og, fx: focal.x, fy: focal.y };
    }
    const r = await putCover(eventId, files, { onProgress: setProgress, signal: ctl.signal });
    if (r.status === "ok") finish(r);
    else onFail(r);
  };

  // Create form went through but the upload failed: same files, same event, only the PUT again.
  const retryUpload = async () => {
    if (!retry || phase === "saving") return;
    setNotice(null);
    setProgress(0);
    setPhase("saving");
    const ctl = new AbortController();
    abort.current = ctl;
    const r = await putCover(retry.eventId, retry.files, { onProgress: setProgress, signal: ctl.signal });
    if (r.status === "ok") {
      setPhase("idle");
      return onHandoffDone?.();
    }
    if (r.status === "unauthenticated") return onUnauthenticated?.();
    if (r.status === "not_found") return onNotFound?.();
    setPhase("idle");
    if (r.status === "aborted") return;
    setRetry({ ...retry, error: r.key, retryAfter: r.status === "rate_limited" ? r.retryAfter : undefined });
  };
  const skipRetry = () => {
    clearCoverHandoff();
    setRetry(null);
    onHandoffDone?.();
  };

  const remove = async () => {
    if (!eventId || removeBusy) return;
    setRemoveBusy(true);
    setRemoveFailed(false);
    const r = await deleteCover(eventId);
    setRemoveBusy(false);
    if (r.status === "ok") {
      setRemoving(false);
      setNotice(null);
      return onStored?.(null);
    }
    if (r.status === "unauthenticated") return onUnauthenticated?.();
    if (r.status === "not_found") return onNotFound?.();
    setRemoveFailed(true);
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void choose(e.dataTransfer.files?.[0]);
  };
  const dropProps = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: drop,
  };

  // ---- pieces ----

  const keepLine = published ? t("cvFailKeepPub") : t("cvFailKeepNone");
  const noticeEl = (() => {
    if (!notice) return null;
    if (notice.kind === "input") {
      const e = notice.error;
      return <Alert kind="err" title={t(e.key, { mb: e.mb ?? 0, w: e.w ?? 0, h: e.h ?? 0 })}>{notice.name}</Alert>;
    }
    if (notice.kind === "soft")
      return (
        <Alert
          kind="warn"
          title={t("cvSoftT", { w: notice.w })}
          acts={<><button type="button" className="btn sm" onClick={useAnyway}>{t("cvUseAnyway")}</button><button type="button" className="btn sm ghost" onClick={otherImage}>{t("cvChooseOther")}</button></>}
        >
          {t("cvSoftS")}
        </Alert>
      );
    if (notice.kind === "fail")
      return (
        <Alert kind="err" title={t("cvFailT")} acts={phase === "pick" && !creating ? <button type="button" className="btn sm" onClick={() => void save()}>{t("cvRetry")}</button> : undefined}>
          {failText(notice.key, notice.retryAfter)} {eventId ? keepLine : ""}
        </Alert>
      );
    if (notice.kind === "text") return <Alert kind="err" title={notice.text} />;
    return <Alert kind="ok" title={t("cvSavedT") + (published ? t("cvSavedLive") : "")}>{t("cvSavedS")}</Alert>;
  })();

  const dropBox = (label: ReactNode, extra?: ReactNode) => (
    <div className={`cv-drop${over ? " over" : ""}`} {...dropProps}>
      <div className="cv-now">
        <div className="cv-thumb" aria-hidden="true"><FallbackCover tone={tone} /></div>
        <small>{t("cvNow")}</small>
      </div>
      <div className="cta">
        {label}
        <p>{over ? t("cvDropOver") : t("cvHint")}</p>
        {extra}
      </div>
    </div>
  );

  const progressEl = (
    <div className="cv-prog" role="status">
      <div className="lbl">
        {progress > 0 ? t("cvUploading", { n: Math.round(progress * 100) }) : t("cvPreparing")}
        <span>{progress > 0 ? t("cvStep") : t("cvPreparingS")}</span>
      </div>
      <div className="cv-track" role="progressbar" aria-label={t("cvUploading", { n: Math.round(progress * 100) })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <i style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
    </div>
  );

  const body = (() => {
    if (retry) {
      return (
        <>
          <Alert
            kind="err"
            title={t("cvCreateFailT")}
            acts={
              <>
                <button type="button" className="btn sm primary" disabled={phase === "saving"} onClick={() => void retryUpload()}>{t("cvRetry")}</button>
                <button type="button" className="btn sm ghost" disabled={phase === "saving"} onClick={skipRetry}>{t("cvSkip")}</button>
              </>
            }
          >
            {t("cvCreateFailS")} {failText(retry.error, retry.retryAfter)}
          </Alert>
          {retryBitmap && <div className="cv-thumb cv-retrythumb"><CropCanvas bitmap={retryBitmap} ratio={2} focal={{ x: retry.files.fx, y: retry.files.fy }} w={400} /></div>}
          {phase === "saving" && progressEl}
        </>
      );
    }
    if (phase === "checking") {
      return (
        <div className="cv-drop">
          <div className="cv-now"><div className="cv-thumb" aria-hidden="true"><FallbackCover tone={tone} /></div></div>
          <div className="cv-prog" role="status">
            <div className="lbl">{src ? t("cvLoadingStored") : t("cvChecking")}</div>
            <div className="cv-track ind" aria-hidden="true"><i /></div>
          </div>
        </div>
      );
    }
    if (phase === "pick" || phase === "saving") {
      const saving = phase === "saving";
      return (
        <>
          {src?.mode === "stored" && <p className="cv-meta cv-refocus">{t("cvRefocusNote")}</p>}
          {src && <CoverPicker bitmap={src.bitmap} name={src.name || eventName} eventName={eventName} focal={focal} locked={saving} onFocal={(f) => { encoded.current = null; setFocal(f); }} />}
          {saving && progressEl}
          {notice && !saving && <div className="cv-gap">{noticeEl}</div>}
          <div className="cv-acts">
            {creating ? (
              <>
                <button type="button" className="btn" onClick={() => { reset(); setNotice(null); }}>{t("cvDiscard")}</button>
                <span className="note">{t("cvNoteCreate")}</span>
              </>
            ) : saving ? (
              <button type="button" className="btn ghost" onClick={() => abort.current?.abort()}>{t("cvCancelUpload")}</button>
            ) : (
              <>
                <button type="button" className="btn primary" onClick={() => void save()}>
                  <Ic n="check" size={18} />{t(src?.mode === "stored" ? "cvSaveFocal" : "cvSave")}
                </button>
                <button type="button" className="btn ghost" onClick={() => { reset(); setNotice(null); }}>{t("cancel")}</button>
                <span className="note">{published ? t("cvNotePub") : t("cvNoteDraft")}</span>
              </>
            )}
          </div>
        </>
      );
    }
    // idle
    if (stored) {
      return (
        <>
          {noticeEl}
          <div className="cv-saved">
            <div className="cv-thumb">
              <CoverMedia cover={stored} tone={tone} size="card" imgClassName="cv-fill" />
            </div>
            <div>
              <p className="cv-meta">{t("cvFocalMeta", { w: stored.width, h: stored.height, x: Math.round(stored.focal.x * 100), y: Math.round(stored.focal.y * 100) })}</p>
              <div className="acts">
                <button type="button" className="btn sm" onClick={() => void pickStored()}><Ic n="pin" size={16} />{t("cvRefocus")}</button>
                <button type="button" className="btn sm" onClick={() => input.current?.click()}><Ic n="swap" size={16} />{t("cvReplace")}</button>
                <button type="button" className="btn sm ghost danger-t" onClick={() => setRemoving(true)}><Ic n="trash" size={16} />{t("cvRemove")}</button>
              </div>
              <p className="pe-hint">{t("cvReplaceNote")}</p>
            </div>
          </div>
        </>
      );
    }
    return (
      <>
        {dropBox(<button type="button" className="btn primary" onClick={() => input.current?.click()}><Ic n="upload" size={18} />{t("cvChoose")}</button>)}
        {notice && <div className="cv-gap">{noticeEl}</div>}
      </>
    );
  })();


  return (
    <section className="pe-fsec" id="cover" aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`}>
        <span className="pe-sn" aria-hidden="true">{sectionNumber}</span>
        {t("cvTitle")} <span className="o">({t("peOptional")})</span>
      </h2>
      {phase === "idle" && !retry && <p className="cv-sub">{t("cvIntro")}</p>}
      {error && phase !== "saving" && <div className="cv-gap"><Alert kind="err" title={t(error.key)} /></div>}
      <input
        ref={input}
        type="file"
        className="sr-only"
        accept={COVER_ACCEPT}
        aria-label={t(stored ? "cvReplace" : "cvChoose")}
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // the same file can be picked again
          void choose(f);
        }}
      />
      {body}
      {!creating && phase === "idle" && !retry && <p className="pe-hint cv-gap">{t("cvNoteSave")}</p>}
      {removing && stored && (
        <Dialog titleId={`${uid}-rt`} descId={`${uid}-rd`} initialFocus={() => document.getElementById(`${uid}-keep`)} onClose={() => !removeBusy && setRemoving(false)}>
          <h2 id={`${uid}-rt`}>{t("cvRmTitle")}</h2>
          <p className="pe-dlgp" id={`${uid}-rd`}>{t("cvRmText")}{published ? t("cvRmLive") : ""}</p>
          <div className="cv-twin" aria-hidden="true">
            <div className="cv-thumb"><CoverMedia cover={stored} tone={tone} size="card" imgClassName="cv-fill" /></div>
            <span>→</span>
            <div className="cv-thumb"><FallbackCover tone={tone} /></div>
          </div>
          {removeFailed && <p className="pe-dlgerr" role="alert">{t("cvRmFail")}</p>}
          <div className="pe-acts">
            <button type="button" className="btn" id={`${uid}-keep`} disabled={removeBusy} onClick={() => setRemoving(false)}>{t("cvRmKeep")}</button>
            <button type="button" className="btn danger solid" disabled={removeBusy} onClick={() => void remove()}><Ic n="trash" size={18} />{t("cvRmOk")}</button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

