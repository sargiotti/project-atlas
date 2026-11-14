import { useI18n } from "../../i18n/I18nProvider";

export default function PanelHome() {
  const { t } = useI18n();
  return (
    <>
      <div className="phead"><h1>{t("myEvents")}</h1></div>
      <div className="empty">
        <svg className="ic" viewBox="0 0 24 24" width="48" height="48" aria-hidden="true">
          <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
        </svg>
        <h2>{t("noEventsTitle")}</h2>
        <p className="muted">{t("noEventsText")}</p>
      </div>
    </>
  );
}
