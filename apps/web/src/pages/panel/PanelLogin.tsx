import { useI18n } from "../../i18n/I18nProvider";
import { Alert, AuthFrame, errorKey, GoogleButton } from "./parts";

export default function PanelLogin() {
  const { t } = useI18n();
  const key = errorKey(new URLSearchParams(window.location.search).get("error"));
  return (
    <AuthFrame>
      <div className="auth">
        <h1>{t("signInTitle")}</h1>
        <p className="lead">{t("signInLead")}</p>
        {key && <Alert>{t(key)}</Alert>}
        <GoogleButton label={t("googleSignIn")} />
        <p className="fine">{t("signInFine")}</p>
        <p className="foot">
          {t("signInFoot")} <b>{t("signInFootAsk")}</b>
        </p>
      </div>
    </AuthFrame>
  );
}
