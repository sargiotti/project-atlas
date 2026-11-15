import { useId } from "react";
import { CategoryIcon } from "../../../../markers/Pixel";
import { CATEGORY_INFO } from "../../../../markers/categories";
import { useI18n } from "../../../../i18n/I18nProvider";
import { displayName } from "../../../../lib/pointLabel";
import { POINT_CATEGORIES, POINT_DESCRIPTION_MAX, POINT_NAME_MAX, cpLen, isNameIt, type EditorPoint } from "../../../../lib/pointsModel";
import { Ic } from "../common";

type Props = {
  point: EditorPoint | null;
  /** Just dropped a Name-it piece: the banner asks for its name. */
  fresh: boolean;
  /** After a refused Save, a missing name is shown as an error. */
  showErrors: boolean;
  /** The server rejected this Point's name or description. */
  serverError: boolean;
  nameRef: React.RefObject<HTMLInputElement | null>;
  onChange: (patch: Partial<Pick<EditorPoint, "name" | "description" | "category">>) => void;
  onDelete: () => void;
  onConfirm: () => void;
  onCancelFresh: () => void;
};

/** Right panel: the selected Point as an editable form. All text is rendered and edited as plain text. */
export default function Inspector({ point, fresh, showErrors, serverError, nameRef, onChange, onDelete, onConfirm, onCancelFresh }: Props) {
  const { t } = useI18n();
  const uid = useId().replace(/:/g, "");

  if (!point) {
    return (
      <div className="ped-ibody">
        <div className="ped-empty">
          <Ic n="pin" size={44} />
          <h2>{t("pedInsNone")}</h2>
          <p>{t("pedInsNoneS")}</p>
          <dl className="ped-keys">
            <div><dt><kbd>{t("pedKeyNudge")}</kbd></dt><dd>{t("pedKeyNudgeS")}</dd></div>
            <div><dt><kbd>{t("pedKeyDel")}</kbd></dt><dd>{t("pedKeyDelS")}</dd></div>
            <div><dt><kbd>{t("pedKeyUndo")}</kbd></dt><dd>{t("pedKeyUndoS")}</dd></div>
          </dl>
        </div>
      </div>
    );
  }

  const nameIt = isNameIt(point.category);
  const catLabel = t(`cat_${point.category}` as any);
  const name = point.name ?? "";
  const nameLen = cpLen(name);
  const descLen = cpLen(point.description);
  const info = CATEGORY_INFO[point.category];
  const nameMissing = nameIt && name.trim() === "";
  const nameErr = nameLen > POINT_NAME_MAX ? t("pedNameLong") : nameMissing && (showErrors || serverError) ? t("pedNameRequired") : serverError ? t("pedErrField") : null;
  const descErr = descLen > POINT_DESCRIPTION_MAX ? t("pedDescLong") : null;

  return (
    <div className="ped-ibody">
      {fresh && nameMissing && (
        <div className="ped-banner-in">
          <Ic n="pencil" size={18} />
          <span>{t("pedBanner", { cat: catLabel.toLowerCase() })}</span>
        </div>
      )}
      <div className="ped-ihead">
        <span className="chip" style={{ "--chip-deep": info?.deep, "--chip-light": info?.light } as React.CSSProperties}>
          <CategoryIcon category={point.category} size={28} />
          {catLabel}
        </span>
        <span className="ped-kind">{nameIt ? t("pedKindName") : t("pedKindDrop")}</span>
      </div>
      <h2 className="ped-ititle" dir="auto">{displayName(point, t)}</h2>

      <div className="ped-form">
        <div className={`ped-fld${nameErr ? " bad" : ""}`}>
          <label htmlFor={`${uid}-name`}>
            <span>{t("pedFieldName")}</span>
            {!nameIt && <small>{t("pedOptional")}</small>}
          </label>
          <input
            id={`${uid}-name`}
            ref={nameRef}
            value={name}
            dir="auto"
            autoComplete="off"
            spellCheck={false}
            placeholder={nameIt ? t("pedNamePh") : catLabel}
            aria-invalid={!!nameErr}
            aria-describedby={`${uid}-nh`}
            onChange={(e) => onChange({ name: nameIt ? e.target.value : e.target.value === "" ? null : e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onConfirm();
              } else if (e.key === "Escape") {
                // Esc on a drop that never got a name takes the drop back.
                if (fresh && nameMissing) {
                  e.preventDefault();
                  onCancelFresh();
                }
              }
            }}
          />
          <div id={`${uid}-nh`} className="ped-fhint">
            {nameErr ? <span className="err" role="alert">{nameErr}</span> : !nameIt ? <span>{t("pedDropNameHint", { cat: catLabel })}</span> : null}
            {nameLen >= 60 && <span className={`cnt${nameLen > POINT_NAME_MAX ? " over" : ""}`}>{nameLen} / {POINT_NAME_MAX}</span>}
          </div>
        </div>

        <div className={`ped-fld${descErr ? " bad" : ""}`}>
          <label htmlFor={`${uid}-desc`}>
            <span>{t("pedFieldDesc")}</span>
            <small>{t("pedOptional")}</small>
          </label>
          <textarea
            id={`${uid}-desc`}
            value={point.description}
            dir="auto"
            rows={4}
            placeholder={t("pedDescPh")}
            aria-invalid={!!descErr}
            aria-describedby={`${uid}-dh`}
            onChange={(e) => onChange({ description: e.target.value })}
          />
          <div id={`${uid}-dh`} className="ped-fhint">
            {descErr && <span className="err" role="alert">{descErr}</span>}
            {descLen >= 400 && <span className={`cnt${descLen > POINT_DESCRIPTION_MAX ? " over" : ""}`}>{descLen} / {POINT_DESCRIPTION_MAX}</span>}
          </div>
        </div>

        <div className="ped-fld">
          <span className="ped-lbl" id={`${uid}-cat`}>{t("pedCategory")}</span>
          <div className="ped-catgrid" role="group" aria-labelledby={`${uid}-cat`}>
            {POINT_CATEGORIES.map((c) => (
              <button key={c} type="button" className={point.category === c ? "on" : ""} aria-pressed={point.category === c} aria-label={t(`cat_${c}` as any)} title={t(`cat_${c}` as any)} onClick={() => onChange({ category: c })}>
                <CategoryIcon category={c} size={26} />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="ped-ifoot">
        <button type="button" className="btn danger" onClick={onDelete}>
          <Ic n="trash" size={18} />{t("pedDelete")} <kbd>{t("pedKeyDel")}</kbd>
        </button>
      </div>
    </div>
  );
}
