import type { OrganizerRequestParsed } from "@atlas/contract";

/** Mail clients must not turn user text into live links: `https://` -> `hxxps://`, `http://` -> `hxxp://`, `www.` -> `www[.]`, bare `name.tld` -> `name[.]tld`. */
export function defang(s: string): string {
  return s.replace(/https:\/\//gi, "hxxps://").replace(/http:\/\//gi, "hxxp://").replace(/www\./gi, "www[.]")
    .replace(/\b([a-z0-9-]+)\.([a-z]{2,})\b/gi, "$1[.]$2");
}

const field = (v: string | undefined) => (v ? defang(v) : "-");

/** Plain-text notification body. The subject is fixed text plus the server-made id, never user input. */
export function buildNotification(id: number, createdAt: number, r: OrganizerRequestParsed, subjectPrefix: string): { subject: string; text: string } {
  const text = [
    `New organizer request #${id}`,
    `Received: ${new Date(createdAt).toISOString()}`,
    "",
    `Name: ${defang(r.name)}`,
    `Email: ${r.email}`,
    `Event: ${defang(r.eventName)}`,
    `Date: ${field(r.eventDate)}`,
    `City: ${field(r.city)}`,
    `Role: ${field(r.role)}`,
    "",
    "Message:",
    field(r.message),
    "",
    "--",
    "Sent by the leyenda.ink organizer form. Reply to this email to answer the organizer.",
    "Every request is also in the panel under Requests.",
    "",
  ].join("\n");
  return { subject: `${subjectPrefix}New organizer request #${id}`, text };
}

/** Sends through Resend. Returns the status to store. Never throws and never logs bodies. */
export async function sendNotification(
  env: { RESEND_API_KEY?: string; NOTIFY_FROM?: string; NOTIFY_TO?: string; NOTIFY_SUBJECT_PREFIX?: string },
  id: number,
  createdAt: number,
  r: OrganizerRequestParsed,
  requestId: string,
): Promise<"sent" | "failed" | "skipped"> {
  if (!env.RESEND_API_KEY || !env.NOTIFY_FROM || !env.NOTIFY_TO) return "skipped";
  const { subject, text } = buildNotification(id, createdAt, r, env.NOTIFY_SUBJECT_PREFIX ?? "");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.NOTIFY_FROM, to: [env.NOTIFY_TO], reply_to: r.email, subject, text }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(`[organizer-email] requestId=${requestId} outcome=failed status=${res.status}`);
    return res.ok ? "sent" : "failed";
  } catch (err) {
    console.error(`[organizer-email] requestId=${requestId} outcome=failed name=${err instanceof Error ? err.name : "NonError"}`);
    return "failed";
  }
}
