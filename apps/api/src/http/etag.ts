export async function etagOf(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `W/"${hex.slice(0, 16)}"`;
}

export function etagMatches(header: string | undefined | null, etag: string): boolean {
  if (!header) return false;
  const strip = (v: string) => v.trim().replace(/^W\//, "");
  return header.split(",").some((candidate) => candidate.trim() === "*" || strip(candidate) === strip(etag));
}
