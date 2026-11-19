import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider, useI18n } from "../src/i18n/I18nProvider";
import { resetGeoLang } from "../src/i18n/geoLang";

function Probe() {
  const { lang, setLang } = useI18n();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <button onClick={() => setLang("da")}>pick da</button>
    </div>
  );
}

function setup({ browser = ["en-GB"], zone = "Europe/Madrid", url = "/" } = {}) {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(browser);
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ timeZone: zone } as any);
  window.history.replaceState(null, "", url);
}

const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("Catalonia default language (slice 21b)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    localStorage.clear();
    resetGeoLang();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.history.replaceState(null, "", "/");
  });

  it("geo ca beats a browser English", async () => {
    setup();
    fetchMock.mockImplementation(() => reply({ lang: "ca" }));
    render(<I18nProvider><Probe /></I18nProvider>);
    await waitFor(() => expect(screen.getByTestId("lang")).toHaveTextContent("ca"));
  });

  it("a stored choice beats geo, and the endpoint is not even called", async () => {
    setup();
    localStorage.setItem("atlas.lang", "en");
    fetchMock.mockImplementation(() => reply({ lang: "ca" }));
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByTestId("lang")).toHaveTextContent("en");
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("lang")).toHaveTextContent("en");
  });

  it.each([
    ["null", ["da-DK"], () => reply({ lang: null }), "da"],
    ["a network error", ["es-AR"], () => Promise.reject(new Error("net")), "es"],
    ["a 429", ["es-AR"], () => reply({}, 429), "es"],
    ["a language we do not offer", ["es-AR"], () => reply({ lang: "fr" }), "es"],
    ["an unexpected extra field", ["es-AR"], () => reply({ lang: "ca", x: 1 }), "es"],
  ] as [string, string[], () => Promise<Response>, string][])("%s from the endpoint falls back silently to the browser language", async (_name, browser, res, expected) => {
    setup({ browser });
    fetchMock.mockImplementation(res);
    render(<I18nProvider><Probe /></I18nProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.getByTestId("lang")).toHaveTextContent(expected);
  });

  it("a request that never answers is aborted after about 1.5 s and the page keeps the browser language", async () => {
    setup({ browser: ["en"] });
    vi.useFakeTimers();
    fetchMock.mockImplementation((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted")))));
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByTestId("lang")).toHaveTextContent("en");
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(screen.getByTestId("lang")).toHaveTextContent("en");
  });

  it("does not call outside the Madrid timezone", async () => {
    setup({ zone: "Europe/London" });
    render(<I18nProvider><Probe /></I18nProvider>);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never writes the geo result to storage; only an explicit pick does", async () => {
    setup();
    fetchMock.mockImplementation(() => reply({ lang: "ca" }));
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(<I18nProvider><Probe /></I18nProvider>);
    await waitFor(() => expect(screen.getByTestId("lang")).toHaveTextContent("ca"));
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(document.cookie).toBe("");
    fireEvent.click(screen.getByText("pick da"));
    expect(screen.getByTestId("lang")).toHaveTextContent("da");
    expect(localStorage.getItem("atlas.lang")).toBe("da");
  });

  it("a pick made before the answer arrives is not overridden by it", async () => {
    setup();
    let finish!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise((r) => (finish = r)));
    render(<I18nProvider><Probe /></I18nProvider>);
    fireEvent.click(screen.getByText("pick da"));
    await act(async () => finish(new Response(JSON.stringify({ lang: "ca" }))));
    expect(screen.getByTestId("lang")).toHaveTextContent("da");
  });

  it("?geo= debug override is forwarded and skips the timezone filter", async () => {
    setup({ zone: "America/New_York", url: "/?geo=ct" });
    fetchMock.mockImplementation(() => reply({ lang: "ca" }));
    render(<I18nProvider><Probe /></I18nProvider>);
    await waitFor(() => expect(screen.getByTestId("lang")).toHaveTextContent("ca"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/geo-lang?geo=ct");
  });
});
