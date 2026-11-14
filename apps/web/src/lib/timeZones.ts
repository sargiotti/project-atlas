import { EVENT_TIME_ZONES } from "@atlas/contract";

// The time zone dropdown is built ONLY from EVENT_TIME_ZONES (the names the API accepts, in the Worker's
// canonical spelling). Never from Intl.supportedValuesOf: engines disagree (Europe/Kiev vs Europe/Kyiv).

const LIST: ReadonlySet<string> = new Set(EVENT_TIME_ZONES);

/** Stored legacy name -> the modern name people expect to read. Only the city and an optional region label. */
const DISPLAY: Record<string, { city: string; region?: string }> = {
  "Europe/Kiev": { city: "Kyiv" },
  "Asia/Calcutta": { city: "Kolkata" },
  "Asia/Saigon": { city: "Ho Chi Minh" },
  "Asia/Katmandu": { city: "Kathmandu" },
  "Asia/Rangoon": { city: "Yangon" },
  "Atlantic/Faeroe": { city: "Faroe" },
  "Atlantic/Cape_Verde": { city: "Cape Verde" },
  "America/Buenos_Aires": { city: "Buenos Aires", region: "America / Argentina" },
  "America/Catamarca": { city: "Catamarca", region: "America / Argentina" },
  "America/Cordoba": { city: "Córdoba", region: "America / Argentina" },
  "America/Jujuy": { city: "Jujuy", region: "America / Argentina" },
  "America/Mendoza": { city: "Mendoza", region: "America / Argentina" },
  "America/Indianapolis": { city: "Indianapolis", region: "America / Indiana" },
  "America/Louisville": { city: "Louisville", region: "America / Kentucky" },
  "America/Godthab": { city: "Nuuk" },
  "America/Coral_Harbour": { city: "Atikokan" },
  "Pacific/Ponape": { city: "Pohnpei" },
  "Pacific/Truk": { city: "Chuuk" },
  "Pacific/Enderbury": { city: "Kanton" },
  "Africa/Asmera": { city: "Asmara" },
  "Antarctica/DumontDUrville": { city: "Dumont d'Urville" },
};

/** Modern (or alternative) name -> the name in EVENT_TIME_ZONES, for engines that report the modern spelling. */
const ALIASES: Record<string, string> = {
  "Europe/Kyiv": "Europe/Kiev",
  "Asia/Kolkata": "Asia/Calcutta",
  "Asia/Ho_Chi_Minh": "Asia/Saigon",
  "Asia/Kathmandu": "Asia/Katmandu",
  "Asia/Yangon": "Asia/Rangoon",
  "Atlantic/Faroe": "Atlantic/Faeroe",
  "America/Argentina/Buenos_Aires": "America/Buenos_Aires",
  "America/Argentina/Catamarca": "America/Catamarca",
  "America/Argentina/Cordoba": "America/Cordoba",
  "America/Argentina/Jujuy": "America/Jujuy",
  "America/Argentina/Mendoza": "America/Mendoza",
  "America/Indiana/Indianapolis": "America/Indianapolis",
  "America/Kentucky/Louisville": "America/Louisville",
  "America/Nuuk": "America/Godthab",
  "America/Atikokan": "America/Coral_Harbour",
  "Pacific/Pohnpei": "Pacific/Ponape",
  "Pacific/Chuuk": "Pacific/Truk",
  "Pacific/Kanton": "Pacific/Enderbury",
  "Africa/Asmara": "Africa/Asmera",
  "Etc/UTC": "UTC",
  "Etc/GMT": "UTC",
  "GMT": "UTC",
};

export function zoneLabel(zone: string): { city: string; region: string } {
  const d = DISPLAY[zone];
  if (d) return { city: d.city, region: d.region ?? zone.split("/").slice(0, -1).join(" / ").replace(/_/g, " ") };
  const parts = zone.split("/");
  return { city: parts[parts.length - 1].replace(/_/g, " "), region: parts.slice(0, -1).join(" / ").replace(/_/g, " ") };
}

function resolved(zone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

let byResolved: Map<string, string> | null = null;
/** What this engine calls each list entry, so "Europe/Kyiv" finds "Europe/Kiev" whichever spelling the engine prefers. */
function engineMap() {
  if (!byResolved) {
    byResolved = new Map();
    for (const z of EVENT_TIME_ZONES) {
      const r = resolved(z);
      if (r && !byResolved.has(r)) byResolved.set(r, z);
    }
  }
  return byResolved;
}

/** Maps a browser-reported zone onto an entry of EVENT_TIME_ZONES, or null (then the field stays unselected). */
export function matchZone(zone: string | undefined | null): string | null {
  if (!zone) return null;
  if (LIST.has(zone)) return zone;
  if (ALIASES[zone]) return ALIASES[zone];
  const r = resolved(zone);
  if (!r) return null;
  if (LIST.has(r)) return r;
  if (ALIASES[r]) return ALIASES[r];
  return engineMap().get(r) ?? null;
}

export function browserZone(): string | null {
  try {
    return matchZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

/** "UTC+1", "UTC−3", "UTC+5:30" at the given instant (default now). */
export function zoneOffset(zone: string, at: Date = new Date()): string {
  try {
    const v = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!v) return "UTC";
    return v.replace("GMT", "UTC").replace("-", "−") || "UTC";
  } catch {
    return "UTC";
  }
}
