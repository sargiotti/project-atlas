import { useI18n } from "../../../../i18n/I18nProvider";
import { Ic } from "../common";

/**
 * First-time onboarding (slice 13 D4): three mini quests (pick a place, add a show, add the next one), then a "lineup
 * started" card. `step` is derived by the editor from what is on screen (0..2 = in progress, 3 = complete).
 */
export default function Quests({ step, onClose }: { step: number; onClose: () => void }) {
  const { t } = useI18n();
  if (step >= 3) {
    return (
      <div className="ped-quest win" role="status">
        <div className="qt"><span>{t("sedQDoneT").toUpperCase()}</span><span className="pips" aria-hidden="true"><i className="on" /><i className="on" /><i className="on" /></span></div>
        <h2>{t("sedQDoneT")}</h2>
        <p>{t("sedQDoneS")}</p>
        <button type="button" className="btn sm" onClick={onClose}><Ic n="check" size={16} />{t("pedQDoneBtn")}</button>
      </div>
    );
  }
  const keys = [["sedQ1T", "sedQ1S"], ["sedQ2T", "sedQ2S"], ["sedQ3T", "sedQ3S"]] as const;
  const [title, text] = keys[step]!;
  return (
    <div className="ped-quest" role="region" aria-label={t("pedQuestN", { n: step + 1 })}>
      <div className="qt">
        <span>{t("pedQuestN", { n: step + 1 })}</span>
        <span className="pips" aria-hidden="true">{[0, 1, 2].map((i) => <i key={i} className={i <= step ? "on" : ""} />)}</span>
      </div>
      <h2>{t(title)}</h2>
      <p>{t(text)}</p>
      <button type="button" className="skip" onClick={onClose}>{t("pedQSkip")}</button>
    </div>
  );
}
