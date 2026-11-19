import { INVITE_TTL_DAYS, type InviteEmailStatus, type OrganizerLocale } from "@atlas/contract";

/** Fixed in code, never from the client or the stored row. */
export const INVITE_FROM = "leyenda.ink <noreply@leyenda.ink>";
export const INVITE_REPLY_TO = "contact@leyenda.ink";

interface Template {
  subject: string;
  /** One line on what leyenda.ink is. */
  about: string;
  accept: string;
  valid: string;
  signIn: string;
}

/**
 * Static copy per locale (slice 31). The locale is only a key into this map. The only interpolations are the note, the link,
 * the recipient email and the day count; there is no user text in a subject.
 */
const TEMPLATES: Record<OrganizerLocale, Template> = {
  en: {
    subject: "Your invitation to leyenda.ink",
    about: "leyenda.ink lets you publish the map of your event so everyone can open it in their phone's browser.",
    accept: "Accept your invitation here:",
    valid: `This link is valid for ${INVITE_TTL_DAYS} days and can be used once.`,
    signIn: "Sign in with the Google account of this email address:",
  },
  es: {
    subject: "Tu invitación a leyenda.ink",
    about: "leyenda.ink te permite publicar el mapa de tu evento para que todos lo abran en el navegador del teléfono.",
    accept: "Acepta tu invitación aquí:",
    valid: `Este enlace es válido durante ${INVITE_TTL_DAYS} días y se puede usar una sola vez.`,
    signIn: "Entra con la cuenta de Google de esta dirección de correo:",
  },
  "es-vos": {
    subject: "Tu invitación a leyenda.ink",
    about: "leyenda.ink te permite publicar el mapa de tu evento para que todos lo abran en el navegador del teléfono.",
    accept: "Aceptá tu invitación acá:",
    valid: `Este enlace es válido por ${INVITE_TTL_DAYS} días y se puede usar una sola vez.`,
    signIn: "Ingresá con la cuenta de Google de esta dirección de correo:",
  },
  ca: {
    subject: "La teva invitació a leyenda.ink",
    about: "leyenda.ink et permet publicar el mapa del teu esdeveniment perquè tothom l'obri al navegador del telèfon.",
    accept: "Accepta la teva invitació aquí:",
    valid: `Aquest enllaç és vàlid durant ${INVITE_TTL_DAYS} dies i només es pot fer servir una vegada.`,
    signIn: "Inicia la sessió amb el compte de Google d'aquesta adreça de correu:",
  },
  da: {
    subject: "Din invitation til leyenda.ink",
    about: "Med leyenda.ink kan du udgive kortet over din begivenhed, så alle kan åbne det i telefonens browser.",
    accept: "Accepter din invitation her:",
    valid: `Linket er gyldigt i ${INVITE_TTL_DAYS} dage og kan kun bruges én gang.`,
    signIn: "Log ind med Google-kontoen for denne e-mailadresse:",
  },
};

/** Plain text only. Order: note (if any), what leyenda.ink is, the link, validity, which Google account, signature. */
export function buildInviteEmail(
  locale: OrganizerLocale,
  v: { note?: string | undefined; link: string; email: string; subjectPrefix?: string | undefined },
): { subject: string; text: string } {
  const t = TEMPLATES[locale];
  const parts = [
    ...(v.note ? [v.note, ""] : []),
    t.about,
    "",
    t.accept,
    v.link,
    "",
    t.valid,
    "",
    `${t.signIn} ${v.email}`,
    "",
    "-- ",
    "leyenda.ink",
    "",
  ];
  return { subject: `${v.subjectPrefix ?? ""}${t.subject}`, text: parts.join("\n") };
}

export interface InviteEmailResult {
  status: InviteEmailStatus;
  /** Resend HTTP status when a response arrived (for the log). */
  httpStatus?: number;
}

/** One recipient, fixed from and reply-to. Never throws and never logs the address, note, link or response body. */
export async function sendInviteEmail(
  env: { RESEND_API_KEY?: string; NOTIFY_SUBJECT_PREFIX?: string },
  locale: OrganizerLocale,
  v: { note?: string | undefined; link: string; email: string },
  requestId: string,
): Promise<InviteEmailResult> {
  if (!env.RESEND_API_KEY) return { status: "skipped" };
  const { subject, text } = buildInviteEmail(locale, { ...v, subjectPrefix: env.NOTIFY_SUBJECT_PREFIX });
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: INVITE_FROM, to: [v.email], reply_to: INVITE_REPLY_TO, subject, text }),
      signal: AbortSignal.timeout(5000),
    });
    return { status: res.ok ? "sent" : "failed", httpStatus: res.status };
  } catch (err) {
    console.error(`[organizer-invite] requestId=${requestId} outcome=email_failed name=${err instanceof Error ? err.name : "NonError"}`);
    return { status: "failed" };
  }
}
