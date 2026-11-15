import {
  EVENT_TIME_ZONES,
  MAX_EVENT_SPAN_DAYS,
  eventInputSchema,
  normalizeText,
  toFieldErrors,
  type EventInputField,
  type FieldError,
  type FieldErrorCode,
  type PanelEvent,
} from "@atlas/contract";
import { browserZone } from "./timeZones";

/** The form's state: plain strings, exactly what the inputs show. */
export type FormValues = {
  name: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  city: string;
  country: string;
  venueAddress: string;
  language: string;
  description: string;
  website: string;
};
export type FieldKey = keyof FormValues;
export type Issue = FieldErrorCode;
export type Issues = Partial<Record<FieldKey, Issue>>;

/** Visual order of the fields (also the tab order and the summary order). */
export const FIELD_ORDER: FieldKey[] = ["name", "language", "startDate", "endDate", "timeZone", "city", "country", "venueAddress", "description", "website"];

export function blankValues(language: string): FormValues {
  return {
    name: "",
    startDate: "",
    endDate: "",
    timeZone: browserZone() ?? "",
    city: "",
    country: "",
    venueAddress: "",
    language,
    description: "",
    website: "",
  };
}

export function fromEvent(e: PanelEvent): FormValues {
  return {
    name: e.name,
    startDate: e.startDate,
    endDate: e.endDate,
    timeZone: e.timeZone,
    city: e.city,
    country: e.country,
    venueAddress: e.venueAddress ?? "",
    language: e.language,
    description: e.description ?? "",
    website: e.website ?? "",
  };
}

/** The request body. Optional fields that are blank go as null; the server normalizes and validates again. */
export function toInput(v: FormValues) {
  return {
    name: v.name,
    startDate: v.startDate,
    endDate: v.endDate,
    timeZone: v.timeZone,
    city: v.city,
    country: v.country,
    venueAddress: v.venueAddress.trim() === "" ? null : v.venueAddress,
    language: v.language,
    description: v.description.trim() === "" ? null : v.description,
    website: v.website.trim() === "" ? null : v.website,
  };
}

const utcDay = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
};
const REAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (d: string) => {
  if (!REAL_DATE.test(d)) return false;
  const [y, m, day] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, day));
  return y >= 2000 && y <= 2099 && t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
};

/** Calendar days counting both ends ("Lasts N days"), or null when either date is not a real day. */
export function daysInclusive(start: string, end: string): number | null {
  if (!isRealDate(start) || !isRealDate(end)) return null;
  return Math.round((utcDay(end) - utcDay(start)) / 86_400_000) + 1;
}

/** Code points as the server counts them (NFC, trimmed, `\r\n` as `\n`). */
export const textLength = (s: string) => Array.from(normalizeText(s)).length;

const REQUIRED_KEYS: FieldKey[] = ["name", "startDate", "endDate", "timeZone", "city", "country"];
const IN_ZONE_LIST: ReadonlySet<string> = new Set(EVENT_TIME_ZONES);

/**
 * Client-side validation for UX, reusing the contract schema. The server stays the authority and may
 * disagree (then its field codes are shown instead).
 */
export function validate(v: FormValues): Issues {
  const out: Issues = {};
  for (const k of REQUIRED_KEYS) if (v[k].trim() === "") out[k] = "required";
  const r = eventInputSchema.safeParse(toInput(v));
  if (!r.success) {
    for (const f of toFieldErrors(r.error)) {
      if (f.path === "body") continue;
      const k = f.path as EventInputField;
      if (out[k]) continue;
      // A zone from our own list is never rejected here, whatever this browser's Intl says about it.
      if (k === "timeZone" && IN_ZONE_LIST.has(v.timeZone)) continue;
      out[k] = f.code;
    }
  }
  return out;
}

export function fromServer(fields: FieldError[]): { issues: Issues; unknown: boolean } {
  const issues: Issues = {};
  let unknown = false;
  for (const f of fields) {
    if (f.path === "body") unknown = true;
    else if (!issues[f.path]) issues[f.path] = f.code;
  }
  return { issues, unknown };
}

export type WebsiteKind = "http" | "noScheme" | "scheme" | "invalid" | "long";

const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

function plausibleHttps(url: string) {
  if (/[\s\u0000-\u001f\u007f-\u009f]/.test(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.includes(".") && !u.username && !u.password;
  } catch {
    return false;
  }
}

/**
 * Explains a rejected website and offers the one-tap https:// fix when the corrected address would pass.
 * The fix is never applied silently: the user taps it.
 */
export function websiteProblem(value: string, code: Issue): { kind: WebsiteKind; fix: string | null } {
  const w = value.trim();
  if (code === "too_long") return { kind: "long", fix: null };
  if (code === "website_not_https" || code === "invalid_url") {
    let fix: string | null = null;
    let kind: WebsiteKind = "invalid";
    if (/^http:\/\//i.test(w)) {
      kind = "http";
      fix = "https://" + w.slice(7);
    } else if (/^https:\/\//i.test(w)) {
      kind = "invalid";
    } else if (SCHEME.test(w)) {
      kind = "scheme";
    } else if (w) {
      kind = "noScheme";
      fix = "https://" + w.replace(/^\/+/, "");
    }
    if (fix && !plausibleHttps(fix)) {
      fix = null;
      if (kind === "http" || kind === "noScheme") kind = kind === "http" ? "http" : "invalid";
    }
    return { kind, fix };
  }
  return { kind: "invalid", fix: null };
}

export function websiteMessageKey(kind: WebsiteKind) {
  return { http: "peErrWebHttp", noScheme: "peErrWebNoScheme", scheme: "peErrWebScheme", invalid: "peErrWebInvalid", long: "peErrWebLong" }[kind] as
    | "peErrWebHttp"
    | "peErrWebNoScheme"
    | "peErrWebScheme"
    | "peErrWebInvalid"
    | "peErrWebLong";
}

/** The only places an organizer URL becomes a link: https at render time, nothing otherwise. */
export function safeHttps(url: string | null | undefined): URL | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

export { MAX_EVENT_SPAN_DAYS };
