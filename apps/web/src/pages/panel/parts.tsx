import type { ReactNode } from "react";
import { authRedirectErrorSchema } from "@atlas/contract";
import LangSwitch from "../../components/LangSwitch";
import { googleStartUrl } from "../../api/auth";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages";
import { Wordmark } from "../../markers/Pixel";
import { Link } from "../../lib/router";
import { SiteFooter } from "../../components/PrivacyLink";

export function Brand({ to = "/panel" }: { to?: string }) {
  const { t } = useI18n();
  return (
    <Link to={to} className="brand">
      <Wordmark />
      <span className="ptag">{t("panelTag")}</span>
    </Link>
  );
}

/** Header for the signed-out screens (login, invite). */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="app" data-theme="auto">
      <div className="auth-head">
        <Brand to="/panel/login" />
        <LangSwitch />
      </div>
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}

const WARN = (
  <svg className="ic" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v6M12 16.5v.5" />
  </svg>
);
export const MAIL = (
  <svg className="ic" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7l9 6 9-6" />
  </svg>
);

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="alert" role="alert">
      {WARN}
      <span>{children}</span>
    </div>
  );
}

/**
 * Plain link to the server-side OAuth start (302 to Google). Local "G" asset, no Google script,
 * no iframe, no rendered Google button: CSP stays script-src 'self'.
 */
export function GoogleButton({ label, inviteToken }: { label: string; inviteToken?: string }) {
  return (
    <a className="gbtn" href={googleStartUrl(inviteToken)}>
      <img src="/google-g.svg" width="20" height="20" alt="" />
      <span>{label}</span>
    </a>
  );
}

/** Fixed i18n string for a callback error code. Unknown or missing codes render nothing (never raw text). */
export function errorKey(raw: string | null): MessageKey | null {
  const parsed = authRedirectErrorSchema.safeParse(raw);
  return parsed.success ? (`err_${parsed.data}` as MessageKey) : null;
}

/** Renders a template containing one `{token}` with the value in bold. React escapes the value. */
export function BoldSlot({ template, token, value }: { template: string; token: string; value: string }) {
  const [a, b = ""] = template.split(`{${token}}`);
  return (
    <>
      {a}
      <b>{value}</b>
      {b}
    </>
  );
}
