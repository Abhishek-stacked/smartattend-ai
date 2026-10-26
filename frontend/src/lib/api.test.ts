import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, download } from "./api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("api client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.cookie = "sa_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });

  it("sends the CSRF cookie on state-changing requests and includes credentials", async () => {
    document.cookie = "sa_csrf=token-123";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api("/auth/logout", { method: "POST" });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.headers["X-CSRF-Token"]).toBe("token-123");
  });

  it("does not send a CSRF header on GET", async () => {
    document.cookie = "sa_csrf=token-123";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await api("/students");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["X-CSRF-Token"]).toBeUndefined();
  });

  it("serialises JSON bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    await api("/auth/login", { method: "POST", body: { email: "a@b.edu", password: "x" } });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ email: "a@b.edu", password: "x" });
  });

  it("passes FormData through untouched", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.append("frame", new Blob(["x"]), "frame.jpg");

    await api("/recognition/detect", { method: "POST", body: form });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init.body).toBe(form);
  });

  it("returns undefined for 204 responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(api("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it("maps error envelopes to ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: "invalid_credentials", message: "Invalid email or password", details: null } }, 401),
      ),
    );

    const error = (await api("/auth/login", { method: "POST", body: {} }).catch((e) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.code).toBe("invalid_credentials");
    expect(error.message).toBe("Invalid email or password");
  });

  it("reports unreachable servers as a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api("/health")).rejects.toMatchObject({ status: 0, code: "network_error" });
  });

  describe("download", () => {
    const createObjectURL = vi.fn(() => "blob:download");
    const revokeObjectURL = vi.fn();
    const anchorClick = vi.fn();

    it("saves the server filename and sends cookies", async () => {
      Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, writable: true, configurable: true });
      Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, writable: true, configurable: true });
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(anchorClick);
      const fetchMock = vi.fn().mockResolvedValue(
        new Response("Date,Present\r\n", {
          status: 200,
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": 'attachment; filename="smartattend-daily-2026-10-25.csv"',
          },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(download("/reports/export?type=daily&fmt=csv", "fallback.csv")).resolves.toBe(
        "smartattend-daily-2026-10-25.csv",
      );
      expect(fetchMock.mock.calls[0][0]).toContain("/api/reports/export?type=daily&fmt=csv");
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include" });
      expect(createObjectURL).toHaveBeenCalled();
      expect(anchorClick).toHaveBeenCalled();
    });

    it("surfaces an error envelope instead of saving a broken file", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: "export_too_large", message: "Narrow the date range" } }, 422),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(download("/reports/export?type=student&fmt=pdf", "fallback.pdf")).rejects.toMatchObject({
        status: 422,
        code: "export_too_large",
        message: "Narrow the date range",
      });
    });
  });
});
