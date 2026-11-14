import { useI18n } from "../i18n/I18nProvider";
import { PRIVACY_LAST_UPDATED, PRIVACY_NOTICE } from "../i18n/privacyNotice";
import { Shell } from "./Pages";

export default function Privacy() {
  const { lang } = useI18n();
  const n = PRIVACY_NOTICE[lang];
  const date = new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${PRIVACY_LAST_UPDATED}T00:00:00Z`),
  );
  return (
    <Shell>
      <article className="privacy">
        <h1>{n.title}</h1>
        <p className="muted">
          {n.updatedLabel}: <time dateTime={PRIVACY_LAST_UPDATED}>{date}</time>
        </p>
        {n.sections.map((s) => (
          <section key={s.heading}>
            <h2>{s.heading}</h2>
            {s.lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </section>
        ))}
      </article>
    </Shell>
  );
}
