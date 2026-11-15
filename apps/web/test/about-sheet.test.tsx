import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { Routes } from "../src/App";
import { mapsSearchUrl } from "../src/lib/maps";
import { buildShareUrl } from "../src/components/ShareDialog";
import { bundle, goTo, json, mockFetch } from "./fixtures";

const about = {
  city: "Copenhagen",
  country: "DK",
  venueAddress: "Strandvejen 1 & 2 #3 100%",
  description: "Line one\nSee https://evil.example now",
  website: "https://www.xn--bcher-kva.example/path?x=1",
};
const withAbout = (over: object = {}) => ({ ...bundle, event: { ...bundle.event, ...about, ...over } });

function open(path = "/e/test-fest", lang: "en" | "es" | "da" = "en") {
  goTo(path);
  return render(
    <I18nProvider initial={lang}>
      <Routes />
    </I18nProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  goTo("/");
});

describe("Google Maps link", () => {
  it("keeps &, #, %, ? and non-ASCII text inside the single query value", () => {
    const href = mapsSearchUrl("Rua São João 5 & 7 #2 100%?", "Zürich", "Switzerland")!;
    const u = new URL(href);
    expect(u.origin + u.pathname).toBe("https://www.google.com/maps/search/");
    expect([...u.searchParams.keys()].sort()).toEqual(["api", "query"]);
    expect(u.searchParams.get("api")).toBe("1");
    expect(u.searchParams.get("query")).toBe("Rua São João 5 & 7 #2 100%?, Zürich, Switzerland");
    expect(u.hash).toBe("");
  });

  it("returns nothing without a venue address", () => {
    expect(mapsSearchUrl("", "Zürich", "Switzerland")).toBeNull();
    expect(mapsSearchUrl("   ", "Zürich", "Switzerland")).toBeNull();
    expect(mapsSearchUrl(null, "Zürich", "Switzerland")).toBeNull();
  });
});

describe("share URL", () => {
  it("never carries the query or the fragment of the current page", () => {
    goTo("/e/test-fest?near=main-stage&at=2026-07-10T20:00#taco-truck");
    expect(buildShareUrl("test-fest")).toBe(`${window.location.origin}/e/test-fest`);
  });
});

describe("visitor About sheet", () => {
  it("does not open by itself; (i) opens it with the event details as plain text", async () => {
    mockFetch(() => json(withAbout()));
    const user = userEvent.setup();
    open();
    await screen.findByRole("button", { name: "Main Stage, Stage" });
    expect(screen.queryByRole("dialog", { name: "About the event" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Event information" }));
    const sheet = await screen.findByRole("dialog", { name: "About the event" });

    expect(within(sheet).getByRole("heading", { name: "Test Fest" })).toBeInTheDocument();
    expect(within(sheet).getByText("Strandvejen 1 & 2 #3 100%")).toBeInTheDocument();
    expect(within(sheet).getByText("Copenhagen, Denmark")).toBeInTheDocument();
    // The description keeps its text, but the URL inside it is not a link.
    expect(within(sheet).getByText(/See https:\/\/evil\.example now/)).toBeInTheDocument();
    // The website is the only link besides the Maps button, shown as its punycode host.
    const site = within(sheet).getByRole("link", { name: "xn--bcher-kva.example" });
    expect(site).toHaveAttribute("href", "https://www.xn--bcher-kva.example/path?x=1");
    expect(site).toHaveAttribute("target", "_blank");
    expect(site.getAttribute("rel")).toContain("noopener");
    const maps = within(sheet).getByRole("link", { name: "Open in Google Maps" });
    expect(new URL(maps.getAttribute("href")!).searchParams.get("query")).toBe("Strandvejen 1 & 2 #3 100%, Copenhagen, Denmark");
    expect(within(sheet).getAllByRole("link")).toHaveLength(2);

    await user.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "About the event" })).not.toBeInTheDocument();
  });

  it("hides the rows it has no data for", async () => {
    mockFetch(() => json(withAbout({ venueAddress: undefined, description: undefined, website: undefined })));
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Event information" }));
    const sheet = await screen.findByRole("dialog", { name: "About the event" });
    expect(within(sheet).getByText("Copenhagen, Denmark")).toBeInTheDocument();
    expect(within(sheet).queryAllByRole("link")).toHaveLength(0);
  });

  it("still opens for a stale cached bundle without the new fields", async () => {
    mockFetch(() => json(bundle));
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Event information" }));
    const sheet = await screen.findByRole("dialog", { name: "About the event" });
    expect(within(sheet).getByRole("heading", { name: "Test Fest" })).toBeInTheDocument();
    expect(within(sheet).queryAllByRole("link")).toHaveLength(0);
  });

  it("Share uses the native sheet with the canonical URL and only the title, and ignores a cancel", async () => {
    mockFetch(() => json(withAbout()));
    const share = vi.fn().mockRejectedValueOnce(Object.assign(new Error("x"), { name: "AbortError" }));
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { userAgent: "test", platform: "", language: "en", languages: ["en"], share, clipboard: { writeText } });
    const user = userEvent.setup({ writeToClipboard: false });
    open("/e/test-fest?near=main-stage#x");
    await user.click(await screen.findByRole("button", { name: "Event information" }));
    const sheet = await screen.findByRole("dialog", { name: "About the event" });

    await user.click(within(sheet).getByRole("button", { name: "Share" }));
    expect(share).toHaveBeenCalledWith({ title: "Test Fest", url: `${window.location.origin}/e/test-fest` });
    expect(writeText).not.toHaveBeenCalled(); // cancelling the share sheet is not an error
    expect(screen.queryByText("Link copied")).not.toBeInTheDocument();
  });

  it("Share copies the link and says so when there is no native share; shows the URL when copying fails", async () => {
    mockFetch(() => json(withAbout()));
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    const user = userEvent.setup({ writeToClipboard: false });
    vi.stubGlobal("navigator", { userAgent: "test", platform: "", language: "en", languages: ["en"], share: undefined, clipboard: { writeText } });
    open();
    await user.click(await screen.findByRole("button", { name: "Event information" }));
    const sheet = await screen.findByRole("dialog", { name: "About the event" });

    await user.click(within(sheet).getByRole("button", { name: "Share" }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/e/test-fest`);
    expect(await within(sheet).findByText("Link copied", { selector: ".pe-acopied" })).toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Share" }));
    const field = await within(sheet).findByRole("textbox", { name: "Event link" });
    expect(field).toHaveValue(`${window.location.origin}/e/test-fest`);
  });
});
