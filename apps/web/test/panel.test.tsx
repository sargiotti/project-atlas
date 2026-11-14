import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { Routes } from "../src/App";
import { errorBody, goTo, json } from "./fixtures";

const TOKEN = "A".repeat(43);
const me = (role: "admin" | "organizer") => ({
  organizer: { id: "o1", displayName: "Sergio Admin", email: "sergio@example.com", role },
});
const invite = (id: string, email: string) => ({
  id,
  email,
  createdAt: "2026-11-12T10:00:00.000Z",
  expiresAt: new Date(Date.now() + 5 * 864e5).toISOString(),
});

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mockApi(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: any, init?: RequestInit) => {
    const url = String(input);
    const key = `${init?.method ?? "GET"} ${url.replace(/^.*\/api\/v1/, "")}`;
    const h = routes[key];
    if (!h) return json(errorBody("not_found"), 404);
    return h(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function renderAt(path: string) {
  goTo(path);
  return render(
    <I18nProvider initial="en">
      <Routes />
    </I18nProvider>,
  );
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => {
  vi.unstubAllGlobals();
  goTo("/");
});

describe("panel guard", () => {
  it("redirects to the login page when there is no session", async () => {
    mockApi({ "GET /auth/me": () => json(errorBody("unauthenticated"), 401) });
    renderAt("/panel");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/panel/login");
  });

  it("shows no-access for a non-admin on admin routes without rendering admin UI or fetching admin data", async () => {
    const fetchMock = mockApi({ "GET /auth/me": () => json(me("organizer")) });
    renderAt("/panel/admin/invites");
    expect(await screen.findByRole("heading", { name: "You don't have access to this page" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Organizer's email")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/admin/"))).toBe(false);
  });

  it("shows no-access when the server answers 403 on the admin list", async () => {
    mockApi({
      "GET /auth/me": () => json(me("admin")),
      "GET /admin/invites": () => json(errorBody("forbidden"), 403),
    });
    renderAt("/panel/admin/invites");
    expect(await screen.findByRole("heading", { name: "You don't have access to this page" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Organizer's email")).not.toBeInTheDocument();
  });

  it("hides the Invites entry from organizers and shows it to admins", async () => {
    mockApi({ "GET /auth/me": () => json(me("organizer")) });
    const user = userEvent.setup();
    const { unmount } = renderAt("/panel");
    await user.click(await screen.findByRole("button", { name: "Account menu" }));
    expect(screen.queryByRole("menuitem", { name: /Invites/ })).not.toBeInTheDocument();
    unmount();

    mockApi({ "GET /auth/me": () => json(me("admin")) });
    renderAt("/panel");
    await user.click(await screen.findByRole("button", { name: "Account menu" }));
    expect(screen.getByRole("menuitem", { name: /Invites/ })).toBeInTheDocument();
  });
});

describe("logout", () => {
  it("posts {} as JSON and goes to the login page", async () => {
    const fetchMock = mockApi({
      "GET /auth/me": () => json(me("organizer")),
      "POST /auth/logout": () => new Response(null, { status: 204 }),
    });
    const user = userEvent.setup();
    renderAt("/panel");
    await user.click(await screen.findByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/auth/logout"))!;
    expect(call[1]!.method).toBe("POST");
    expect((call[1]!.headers as any)["Content-Type"]).toBe("application/json");
    expect(call[1]!.body).toBe("{}");
  });

  it("stays signed in and says so when sign-out fails", async () => {
    mockApi({
      "GET /auth/me": () => json(me("organizer")),
      "POST /auth/logout": () => json(errorBody("invalid_origin"), 403),
    });
    const user = userEvent.setup();
    renderAt("/panel");
    await user.click(await screen.findByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByText("We couldn't sign you out. Please try again.")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/panel");
  });
});

describe("sign-in links and callback errors", () => {
  it("login is a plain link to the OAuth start and maps the error code to a fixed string", async () => {
    goTo("/panel/login?error=no_access");
    render(<I18nProvider initial="en"><Routes /></I18nProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("This Google account doesn't have access to Atlas.");
    expect(screen.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/api/v1/auth/google/start");
  });

  it("never renders an unknown error code", async () => {
    goTo("/panel/login?error=%3Cb%3Eboom%3C%2Fb%3E");
    render(<I18nProvider initial="en"><Routes /></I18nProvider>);
    await screen.findByRole("heading", { name: "Sign in" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
  });
});

describe("invite page", () => {
  const inspect = (body: unknown, status = 200) => ({ "POST /invites/inspect": () => json(body, status) });

  it("valid: shows inviter and the invited email, and continues with the token", async () => {
    const fetchMock = mockApi(inspect({ status: "valid", email: "ana@havnelobet.dk", inviterName: "Sergio A." }));
    renderAt(`/panel/invite/${TOKEN}`);
    expect(await screen.findByText("ana@havnelobet.dk")).toBeInTheDocument();
    expect(screen.getByText("Sergio A.")).toBeInTheDocument();
    expect(screen.getByText(/invited you to publish event maps on Atlas/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute(
      "href",
      `/api/v1/auth/google/start?invite=${TOKEN}`,
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init!.body as string)).toEqual({ token: TOKEN });
    expect(screen.queryByText(/organization/i)).not.toBeInTheDocument();
  });

  it.each([
    ["used", "This invite link has already been used"],
    ["expired", "This invite link has expired"],
    ["revoked", "This invite link is no longer valid"],
  ])("%s: shows a clear end state and no Google button", async (status, title) => {
    mockApi(inspect({ status }));
    renderAt(`/panel/invite/${TOKEN}`);
    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Google/ })).not.toBeInTheDocument();
  });

  it("unknown or malformed token: invalid state (malformed never hits the API)", async () => {
    const fetchMock = mockApi(inspect(errorBody("invite_not_found"), 404));
    const { unmount } = renderAt(`/panel/invite/${TOKEN}`);
    expect(await screen.findByRole("heading", { name: "This invite link is no longer valid" })).toBeInTheDocument();
    unmount();
    fetchMock.mockClear();
    renderAt("/panel/invite/short");
    expect(await screen.findByRole("heading", { name: "This invite link is no longer valid" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("email mismatch: shows only the invited email and offers another Google account", async () => {
    mockApi(inspect({ status: "valid", email: "ana@havnelobet.dk", inviterName: "Sergio A." }));
    goTo(`/panel/invite/${TOKEN}?error=invite_email_mismatch`);
    render(<I18nProvider initial="en"><Routes /></I18nProvider>);
    expect(await screen.findByRole("heading", { name: "This invite is for a different email" })).toBeInTheDocument();
    expect(screen.getByText("ana@havnelobet.dk")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try another Google account" })).toHaveAttribute(
      "href",
      `/api/v1/auth/google/start?invite=${TOKEN}`,
    );
  });

  it("other callback errors show a fixed message above the button", async () => {
    mockApi(inspect({ status: "valid", email: "ana@havnelobet.dk", inviterName: "Sergio A." }));
    goTo(`/panel/invite/${TOKEN}?error=email_not_verified`);
    render(<I18nProvider initial="en"><Routes /></I18nProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("isn't verified");
    expect(screen.getByRole("link", { name: "Continue with Google" })).toBeInTheDocument();
  });
});

describe("admin invites", () => {
  const link = `/panel/invite/${"B".repeat(43)}`;
  function adminApi(extra: Record<string, Handler> = {}) {
    return mockApi({
      "GET /auth/me": () => json(me("admin")),
      "GET /admin/invites": () => json({ invites: [invite("i1", "mette@kulturnat.dk")] }),
      ...extra,
    });
  }

  it("rejects an invalid email on the client without calling the API", async () => {
    const fetchMock = adminApi();
    const user = userEvent.setup();
    renderAt("/panel/admin/invites");
    const input = await screen.findByLabelText("Organizer's email");
    await user.type(input, "lars@nightfall");
    await user.click(screen.getByRole("button", { name: "Create invite link" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a valid email address.");
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === "POST")).toBe(false);
  });

  it("creates an invite, shows the full link once with a copy button, then never again", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const fetchMock = adminApi({
      "POST /admin/invites": () => json({ invite: invite("i2", "ana@havnelobet.dk"), invitePath: link }, 201),
    });
    const user = userEvent.setup();
    renderAt("/panel/admin/invites");
    await user.type(await screen.findByLabelText("Organizer's email"), " Ana@Havnelobet.dk ");
    await user.click(screen.getByRole("button", { name: "Create invite link" }));

    const box = await screen.findByLabelText("Invite link");
    expect(box).toHaveValue(window.location.origin + link);
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({ email: "ana@havnelobet.dk" });
    expect((post[1]!.headers as any)["Content-Type"]).toBe("application/json");
    expect(screen.getAllByText("ana@havnelobet.dk").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await navigator.clipboard.readText()).toBe(window.location.origin + link);
    expect(await screen.findByRole("button", { name: "Copied!" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText("Invite link")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("B".repeat(43));
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it.each([
    ["email_already_registered", "That email already has an Atlas account."],
    ["invite_already_pending", "There is already a pending invite for that email."],
    ["invite_cap_reached", "You've reached the maximum of pending invites."],
  ])("maps the 409 %s to a fixed message", async (code, text) => {
    adminApi({ "POST /admin/invites": () => json(errorBody(code), 409) });
    const user = userEvent.setup();
    renderAt("/panel/admin/invites");
    await user.type(await screen.findByLabelText("Organizer's email"), "ana@havnelobet.dk");
    await user.click(screen.getByRole("button", { name: "Create invite link" }));
    expect(await screen.findByText(new RegExp(text))).toBeInTheDocument();
    expect(screen.queryByLabelText("Invite link")).not.toBeInTheDocument();
  });

  it("revokes a pending invite after an inline confirmation", async () => {
    const fetchMock = adminApi({ "DELETE /admin/invites/i1": () => new Response(null, { status: 204 }) });
    const user = userEvent.setup();
    renderAt("/panel/admin/invites");
    await user.click(await screen.findByRole("button", { name: "Revoke mette@kulturnat.dk" }));
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === "DELETE")).toBe(false);
    expect(screen.getByText("Revoke this invite? It stops working right away.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(screen.queryByText("mette@kulturnat.dk")).not.toBeInTheDocument());
    expect(screen.getByText("No pending invites")).toBeInTheDocument();
  });
});
