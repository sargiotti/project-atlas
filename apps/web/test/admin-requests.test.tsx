import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { errorBody, json } from "./fixtures";
import AdminRequests from "../src/pages/panel/admin/AdminRequests";

const row = (id: string, over: any = {}) => ({
  id, name: `Name ${id}`, email: `p${id}@example.com`, eventName: `Event ${id}`, eventDate: null, city: null, role: null, message: null,
  emailStatus: "sent", createdAt: 1763500000000, status: "pending", locale: "ca", invitedAt: null, inviteExpiresAt: null, inviteState: null, sourceRef: null, pageLang: null, ...over,
});
const invited = (id: string) => row(id, { status: "invited", invitedAt: 1763600000000, inviteExpiresAt: 1764200000000, inviteState: "active" });

const win = (total: number, o: any = {}) => ({
  total, byLang: { es: 2, ca: 0, en: 1, da: 0, none: 1 }, byRef: { top: [{ ref: "mail-fiestas-1", count: 2 }], other: 1, none: 3 }, ...o,
});
const SUMMARY = { last7d: win(4), last30d: win(9) };

/** Routes the page's calls: the list and the POST actions. `post` decides the answer to a POST. */
function api(rows: any[], post: (url: string, body: any) => Response | Promise<Response>) {
  const calls: { url: string; body?: any }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, body });
    if (init?.method === "POST") return post(url, body);
    if (url.endsWith("/summary")) return json(SUMMARY);
    return json({ requests: rows, nextCursor: null });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const page = () =>
  render(
    <I18nProvider initial="en">
      <AdminRequests />
    </I18nProvider>,
  );

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("admin requests: filter", () => {
  it("asks for Pending by default and refetches with the chosen status, which is reflected in the URL", async () => {
    const calls = api([row("1")], () => json({}));
    const user = userEvent.setup();
    page();
    expect(await screen.findByText("Event 1")).toBeInTheDocument();
    expect(calls[0].url).toContain("status=pending");
    expect(screen.getByRole("button", { name: "Pending" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Discarded" }));
    await waitFor(() => expect(calls.at(-1)!.url).toContain("status=discarded"));
    expect(window.location.search).toBe("?status=discarded");
  });

  it("falls back to Pending when the URL carries an unknown status", async () => {
    window.history.replaceState(null, "", "/?status=hacked");
    const calls = api([], () => json({}));
    page();
    await screen.findByText("No requests yet.");
    expect(calls[0].url).toContain("status=pending");
  });
});

describe("admin requests: invite", () => {
  it("sends the note, disables Send while in flight, shows a toast and removes the row from Pending", async () => {
    let release!: (r: Response) => void;
    const calls = api([row("1"), row("2")], () => new Promise<Response>((res) => (release = res)));
    const user = userEvent.setup();
    page();
    await user.click(await screen.findByRole("button", { name: "Invite: Name 1" }));

    const dlg = screen.getByRole("alertdialog");
    expect(within(dlg).getByLabelText("Recipient email")).toHaveAttribute("readonly");
    expect(within(dlg).getByLabelText(/Personal note/)).toHaveAttribute("maxlength", "1000");
    await user.type(within(dlg).getByLabelText(/Personal note/), "Hi!");
    expect(within(dlg).getByText("3 / 1000")).toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: "Send invite" }));

    const sending = within(dlg).getByRole("button", { name: "Sending…" });
    expect(sending).toBeDisabled();
    const post = calls.find((c) => c.body !== undefined)!;
    expect(post.url).toBe("/api/v1/admin/organizer-requests/1/invite");
    expect(post.body).toEqual({ note: "Hi!" });

    release(json({ request: invited("1"), emailStatus: "sent" }, 201));
    expect(await screen.findByText("Invite sent to p1@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByText("Event 1")).toBeNull(); // no longer Pending
    expect(screen.getByText("Event 2")).toBeInTheDocument();
  });

  it("shows the link once when the email failed, copies it, and forgets it when the dialog closes", async () => {
    api([row("1")], () => json({ request: invited("1"), emailStatus: "failed", inviteLink: "https://leyenda.ink/panel/invite/SECRET" }, 201));
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    page();
    await user.click(await screen.findByRole("button", { name: "Invite: Name 1" }));
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    const dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getByText("Email failed: copy this link now")).toBeInTheDocument();
    expect(within(dlg).getByLabelText("Invite link")).toHaveValue("https://leyenda.ink/panel/invite/SECRET");
    expect(within(dlg).getByText(/won't be shown again/)).toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith("https://leyenda.ink/panel/invite/SECRET");

    await user.click(within(dlg).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.body.textContent).not.toContain("SECRET");
    expect(window.location.href).not.toContain("SECRET");
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain("SECRET");
  });

  it("tells the admin the list changed on 409 invalid_transition and refreshes on close", async () => {
    const calls = api([row("1")], () => json(errorBody("invalid_transition"), 409));
    const user = userEvent.setup();
    page();
    await user.click(await screen.findByRole("button", { name: "Invite: Name 1" }));
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    const dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getByRole("alert")).toHaveTextContent("The list changed. Refresh to see the current state.");
    expect(within(dlg).queryByRole("button", { name: "Send invite" })).toBeNull();
    const before = calls.filter((c) => c.body === undefined).length;
    await user.click(within(dlg).getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(calls.filter((c) => c.body === undefined).length).toBe(before + 1));
  });

  it("offers Invite again when a plain Invite hits invite_already_pending", async () => {
    const calls = api([row("1")], (url) =>
      url.endsWith("/invite") ? json(errorBody("invite_already_pending"), 409) : json({ request: invited("1"), emailStatus: "sent" }, 201),
    );
    const user = userEvent.setup();
    page();
    await user.click(await screen.findByRole("button", { name: "Invite: Name 1" }));
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    const dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getByRole("alert")).toHaveTextContent("There is already an active invite for this email.");
    await user.click(within(dlg).getByRole("button", { name: "Invite again" }));
    await waitFor(() => expect(calls.at(-1)!.url).toBe("/api/v1/admin/organizer-requests/1/invite-again"));
  });

  it("says the person already has an account", async () => {
    api([row("1")], () => json(errorBody("email_already_registered"), 409));
    const user = userEvent.setup();
    page();
    await user.click(await screen.findByRole("button", { name: "Invite: Name 1" }));
    await user.click(screen.getByRole("button", { name: "Send invite" }));
    expect(await screen.findByText("This person already has an account.")).toBeInTheDocument();
  });
});

describe("admin requests: row actions", () => {
  it("offers only the actions that fit each status", async () => {
    window.history.replaceState(null, "", "/?status=all");
    api([row("1"), invited("2"), row("3", { status: "joined" }), row("4", { status: "discarded" })], () => json({}));
    page();
    await screen.findByText("Event 1");
    expect(screen.getByRole("button", { name: "Invite: Name 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard: Name 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite again: Name 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard: Name 2" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Name 3/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Restore: Name 4" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite: Name 4" })).toBeNull();
  });
});

describe("admin requests: source summary (slice 44)", () => {
  it("shows the counts per window, 'direct' for no ref and each row's language and ref as plain text", async () => {
    api([row("1", { pageLang: "ca", sourceRef: "mail-fiestas-1" }), row("2", { pageLang: null, sourceRef: null })], () => json({}));
    page();
    expect(await screen.findByText("Event 1")).toBeInTheDocument();
    const box = within(screen.getByRole("group", { name: "Summary" }));
    expect(await box.findByText("Last 7 days")).toBeInTheDocument();
    expect(box.getAllByText(/mail-fiestas-1 2 · Other 1 · direct 3/)).toHaveLength(2);
    expect(box.getAllByText(/ES 2 · EN 1 · — 1/).length).toBeGreaterThan(0);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("CA")).toBeInTheDocument();
    expect(within(rows[0]).getByText("mail-fiestas-1")).toBeInTheDocument();
    expect(within(rows[1]).getByText("direct")).toBeInTheDocument();
  });
});
