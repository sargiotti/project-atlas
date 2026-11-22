import { useEffect, useMemo, type MouseEvent } from "react";
import { ORGANIZER_FORM_ID } from "@atlas/contract";
import LangSwitch from "../components/LangSwitch";
import QrSvg from "../components/QrSvg";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages";
import { Link } from "../lib/router";
import { splitEmphasis, kitMeta, toKitLang } from "../lib/shareKit/copy";
import { buildEventUrl, makeQr } from "../lib/shareKit/qr";
import { CATEGORY_INFO } from "../markers/categories";
import { CategoryIcon, Wordmark } from "../markers/Pixel";
import { BenefitIcon, MapScreen, Phone, PinSymbol, SCENE_NAMES, Scenery, UC_CATS } from "./organizers/art";
import OrganizerForm from "./organizers/OrganizerForm";
import "./organizers/organizers.css";

const FORM_ID = ORGANIZER_FORM_ID; // same anchor in every language
const DEMO_SLUG = "fiestas-la-alameda";
const DEMO_EVENT = { name: "Fiestas de La Alameda", startDate: "2026-12-04", endDate: "2026-12-07", city: "Valencia" };
const CONTACT = "contact@leyenda.ink";

/** Example event slug per use case; a card links to /e/<slug> only when one is set (slice 33b adds congreso and escuela). */
export const UC_EXAMPLE_SLUGS: Partial<Record<(typeof SCENE_NAMES)[number], string>> = {
  fiestas: "fiestas-la-alameda",
  musica: "nightfall-meadows",
  carrera: "havnelobet",
  mercado: "mercado-medieval-toledo",
};

const BENEFITS: ["toilets" | "refresh" | "lang" | "free", MessageKey, MessageKey][] = [
  ["toilets", "orgBen1T", "orgBen1P"],
  ["refresh", "orgBen2T", "orgBen2P"],
  ["lang", "orgBen3T", "orgBen3P"],
  ["free", "orgBen4T", "orgBen4P"],
];
const FAQ: [MessageKey, MessageKey][] = [
  ["orgFaq1Q", "orgFaq1A"], ["orgFaq2Q", "orgFaq2A"], ["orgFaq3Q", "orgFaq3A"], ["orgFaq4Q", "orgFaq4A"], ["orgFaq5Q", "orgFaq5A"],
];

/** Every CTA scrolls to the form and moves focus to its first field. */
function toForm(e: MouseEvent<HTMLAnchorElement>) {
  const target = document.getElementById(FORM_ID);
  if (!target) return;
  e.preventDefault();
  const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView?.({ behavior: calm ? "auto" : "smooth", block: "start" });
  window.history.replaceState({}, "", `#${FORM_ID}`);
  target.querySelector<HTMLElement>("input")?.focus({ preventScroll: true });
}

function Cta({ small, className = "" }: { small?: boolean; className?: string }) {
  const { t } = useI18n();
  return (
    <a className={`org-btn${small ? " sm" : ""} ${className}`.trim()} href={`#${FORM_ID}`} onClick={toForm}>
      {t("orgCta")}
    </a>
  );
}

export default function Organizers() {
  const { t, lang } = useI18n();
  const qr = useMemo(() => makeQr(buildEventUrl(DEMO_SLUG)), []);
  const kitLang = toKitLang(lang);
  const mapLabels: [string, string, string] = [t("map"), t("list"), t("schedule")];

  useEffect(() => {
    const prev = document.title;
    document.title = t("orgDocTitle");
    return () => {
      document.title = prev;
    };
  }, [t]);

  const steps = [
    { title: "orgStep1T", text: "orgStep1P", screen: (
      <div className="org-ms org-ms-upload"><div><span aria-hidden="true">↑</span><br />{t("orgMockUpload")}</div></div>
    ) },
    { title: "orgStep2T", text: "orgStep2P", screen: <MapScreen name={DEMO_EVENT.name} labels={mapLabels} pw={13} lazy /> },
    { title: "orgStep3T", text: "orgStep3P", screen: (
      <div className="org-ms org-ms-share">
        <div className="qr"><QrSvg qr={qr} label="" /></div>
        <div className="pills"><span className="p1">{t("skPng")}</span><span className="p2">{t("skFlyer")}</span></div>
      </div>
    ) },
  ] as const;

  return (
    <div className="app org" data-theme="light">
      <PinSymbol />
      <header className="app org-hdr" data-theme="dark">
        <div className="org-w org-hdr-in">
          <Link to="/" className="org-brand"><Wordmark /></Link>
          <div className="org-hdr-r">
            <LangSwitch />
            <Cta small className="org-hdr-cta" />
          </div>
        </div>
      </header>

      <main>
        <div className="app org-top" data-theme="dark">
          <div className="org-w">
            <section className="org-hero" aria-labelledby="org-h1">
              <div className="org-himg">
                <img src="/organizers/hero.webp" width="1344" height="768" alt={t("orgHeroAlt")} fetchPriority="high" decoding="async" />
                <span className="org-aicap">{t("orgAiCaption")}</span>
              </div>
              <div className="org-htext">
                <p className="org-eyebrow">{t("orgEyebrow")}</p>
                <h1 id="org-h1">{t("orgH1")}</h1>
                <p className="org-tagline">{t("orgTagline")}</p>
                <p className="org-lead">{t("orgLead")}</p>
                <div className="org-cta"><Cta /></div>
                <p className="org-micro"><span>{t("orgMicro1")}</span><span>{t("orgMicro2")}</span></p>
              </div>
            </section>
          </div>
        </div>

        <section className="org-band" aria-labelledby="org-band-h">
          <div className="org-w org-band-in">
            <figure>
              <QrSvg qr={qr} label="" className="org-q" />
              <figcaption>{t("orgScan")}</figcaption>
            </figure>
            <div className="org-bt">
              <h2 id="org-band-h">{t("orgBandH")}</h2>
              <p>{t("orgBandText")}</p>
            </div>
          </div>
        </section>

        <section className="org-s" aria-labelledby="org-steps-h">
          <div className="org-w">
            <div className="org-shead"><h2 id="org-steps-h" className="org-h2">{t("orgStepsH")}</h2><p className="org-lead2">{t("orgStepsLead")}</p></div>
            <div className="org-rail org-steps" role="region" aria-label={t("orgStepsLabel")} tabIndex={0}>
              {steps.map((s, i) => (
                <div className="org-stp" key={s.title}>
                  <div className="stage"><Phone>{s.screen}</Phone></div>
                  <span className="k">{t("orgStepN", { n: i + 1 })}</span>
                  <h3>{t(s.title)}</h3>
                  <p>{t(s.text)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="org-s org-s-tight" aria-labelledby="org-ben-h">
          <div className="org-w">
            <div className="org-shead"><h2 id="org-ben-h" className="org-h2">{t("orgBenH")}</h2><p className="org-lead2">{t("orgBenLead")}</p></div>
            <ul className="org-ben">
              {BENEFITS.map(([k, ti, p]) => (
                <li key={ti}><BenefitIcon kind={k} /><h3>{t(ti)}</h3><p>{t(p)}</p></li>
              ))}
            </ul>
          </div>
        </section>

        <section className="app org-s org-share" data-theme="dark" aria-labelledby="org-share-h">
          <div className="org-w org-g12">
            <div className="org-txt">
              <h2 id="org-share-h" className="org-h2">{t("orgShareH")}</h2>
              <p className="org-lead2">{t("orgShareLead")}</p>
              <div className="org-chip" aria-hidden="true"><span>{`leyenda.ink/e/${DEMO_SLUG}`}</span><i>{t("skCopy")}</i></div>
            </div>
            <div className="org-kit" aria-hidden="true">
              <div className="org-badge">
                <b>{DEMO_EVENT.name}</b>
                <small>{kitMeta(DEMO_EVENT, kitLang, "short")}</small>
                <QrSvg qr={qr} label="" />
                <div className="c">{t("orgScan")}</div>
                <Wordmark />
              </div>
              <div className="org-flyer">
                <b>{DEMO_EVENT.name}</b>
                <small>{kitMeta(DEMO_EVENT, kitLang, "long")}</small>
                <QrSvg qr={qr} label="" />
                <div className="c">{splitEmphasis(t("orgFlyerCta")).map((p, i) => (p.em ? <u key={i}>{p.text}</u> : <span key={i}>{p.text}</span>))}</div>
                <div className="f"><span>{`leyenda.ink/e/${DEMO_SLUG}`}</span><Wordmark /></div>
              </div>
            </div>
          </div>
        </section>

        <section className="org-s" aria-labelledby="org-uc-h">
          <div className="org-w">
            <div className="org-shead"><h2 id="org-uc-h" className="org-h2">{t("orgUcH")}</h2><p className="org-lead2">{t("orgUcLead")}</p></div>
            <div className="org-rail org-ucs" role="region" aria-label={t("orgUcLabel")} tabIndex={0}>
              {SCENE_NAMES.map((name, i) => {
                const n = i + 1;
                const slug = UC_EXAMPLE_SLUGS[name];
                return (
                  <article className={`org-uc${i === 0 ? " first" : ""}${slug ? " linked" : ""}`} data-usecase={name} key={name}>
                    <Scenery name={name} />
                    <div className="org-ucb">
                      <h3>{t(`orgUc${n}T` as MessageKey)}</h3>
                      <ul aria-label={t("orgUcPoints")}>
                        {UC_CATS[name].map((cat, j) => (
                          <li key={j} style={{ background: CATEGORY_INFO[cat].light, color: CATEGORY_INFO[cat].deep }}>
                            <CategoryIcon category={cat} size={18} />
                            {t(`orgUc${n}P${j + 1}` as MessageKey)}
                          </li>
                        ))}
                      </ul>
                      {slug && <Link to={`/e/${slug}`} className="org-uc-link">{t("orgUcExample")} →</Link>}
                    </div>
                  </article>
                );
              })}
            </div>
            <p className="org-hint">{t("orgUcHint")}</p>
          </div>
        </section>

        <section className="org-s org-s-tight" aria-labelledby="org-faq-h">
          <div className="org-w">
            <div className="org-shead">
              <h2 id="org-faq-h" className="org-h2">{t("orgFaqH")}</h2>
              <p className="org-lead2">{t("orgFaqLead")} <a href={`mailto:${CONTACT}`}>{CONTACT}</a></p>
            </div>
            <div className="org-faq">
              {[FAQ.slice(0, 3), FAQ.slice(3)].map((col, c) => (
                <div key={c}>
                  {col.map(([q, a], i) => (
                    <details key={q} open={c === 0 && i === 0}>
                      <summary>{t(q)}</summary>
                      <p>{t(a)}</p>
                    </details>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="org-s org-formsec" id={FORM_ID} aria-labelledby="org-form-h">
          <div className="org-w org-g12">
            <div className="org-ftxt">
              <h2 id="org-form-h" className="org-h2">{t("orgFormH")}</h2>
              <p className="org-lead2">{t("orgFormLead")}</p>
              <ol className="org-after">
                {(["orgAfter1", "orgAfter2", "orgAfter3"] as const).map((k, i) => (
                  <li key={k}><b aria-hidden="true">{i + 1}</b>{t(k)}</li>
                ))}
              </ol>
              <p className="org-mailalt">{t("orgMailAlt")} <a href={`mailto:${CONTACT}`}>{CONTACT}</a></p>
            </div>
            <div className="org-fcard"><OrganizerForm /></div>
          </div>
        </section>
      </main>

      <footer className="app org-ftr" data-theme="dark">
        <div className="org-w org-g12">
          <div className="org-fw"><Wordmark /></div>
          <p className="org-free">{t("orgFree")}</p>
          <div className="org-links">
            <Link to="/">{t("orgFootHome")}</Link>
            <Link to="/privacy">{t("privacyLink")}</Link>
            <Link to="/terms">{t("termsLink")}</Link>
            <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

