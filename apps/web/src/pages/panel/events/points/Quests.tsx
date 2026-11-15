import { useI18n } from "../../../../i18n/I18nProvider";
import { Ic } from "../common";

/**
 * First-time onboarding: three mini quests (drop a stage, name it, drop the toilets), then a "quests complete" card.
 * `step` is derived by the editor from the Points on the map (0..2 = quest in progress, 3 = complete).
 */
export default function Quests({ step, onClose }: { step: number; onClose: () => void }) {
  const { t } = useI18n();
  if (step >= 3) {
    return (
      <div className="ped-quest win" role="status">
        <div className="qt"><span>{t("pedQDoneT").toUpperCase()}</span><span className="pips" aria-hidden="true"><i className="on" /><i className="on" /><i className="on" /></span></div>
        <h2>{t("pedQDoneT")}</h2>
        <p>{t("pedQDoneS")}</p>
        <button type="button" className="btn sm" onClick={onClose}><Ic n="check" size={16} />{t("pedQDoneBtn")}</button>
      </div>
    );
  }
  const keys = [["pedQ1T", "pedQ1S"], ["pedQ2T", "pedQ2S"], ["pedQ3T", "pedQ3S"]] as const;
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
