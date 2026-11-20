import type { ReactNode } from "react";
import { TERMS_VERSION } from "@atlas/contract";
import { useI18n } from "../i18n/I18nProvider";
import { TERMS_NOTICE } from "../i18n/termsNotice";
import { Link } from "../lib/router";
import { Shell } from "./Pages";

const CONTACT = "contact@leyenda.ink";

/** Turns the two fixed tokens (contact email, /privacy) into links. Everything else stays plain text. */
function withLinks(text: string): ReactNode[] {
  return text.split(/(contact@leyenda\.ink|\/privacy)/).map((part, i) => {
    if (part === CONTACT) return <a key={i} href={`mailto:${CONTACT}`}>{CONTACT}</a>;
    if (part === "/privacy") return <Link key={i} to="/privacy">/privacy</Link>;
    return part;
  });
}

export default function Terms() {
  const { lang } = useI18n();
  const n = TERMS_NOTICE[lang];
  return (
    <Shell>
      <article className="privacy">
        <h1>{n.title}</h1>
        <p className="muted">
          {n.versionLabel}: {TERMS_VERSION}
        </p>
        {n.sections.map((s) => (
          <section key={s.heading}>
            <h2>{s.heading}</h2>
            {s.p?.map((l) => <p key={l}>{withLinks(l)}</p>)}
            {s.ul && (
              <ul>
                {s.ul.map((l) => <li key={l}>{withLinks(l)}</li>)}
              </ul>
            )}
          </section>
        ))}
      </article>
    </Shell>
  );
}
