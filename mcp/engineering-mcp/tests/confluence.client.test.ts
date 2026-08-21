import { describe, expect, it, vi } from "vitest";
import { ConfluenceClient } from "../src/integrations/confluence/confluence.client.js";
import {
  ConfluenceAuthenticationError,
  ConfluenceNotFoundError,
  ConfluenceRateLimitError,
  ConfluenceTimeoutError,
  ConfluenceUnavailableError,
  ConfluenceValidationError,
} from "../src/integrations/confluence/confluence.errors.js";

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
  });
}

describe("ConfluenceClient", () => {
  it("sends authenticated GET requests under /wiki", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain("https://example.atlassian.net/wiki/rest/api/space/KYGO");
      return jsonResponse(200, { key: "KYGO" });
    });
    const client = new ConfluenceClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "secret-token",
      fetchImpl,
      maxRetries: 0,
    });

    await expect(client.get("/rest/api/space/KYGO")).resolves.toEqual({ key: "KYGO" });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization?.startsWith("Basic ")).toBe(true);
    expect(JSON.stringify(init)).not.toContain("secret-token");
  });

  it("normalizes base URL that already includes /wiki", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe(
        "https://example.atlassian.net/wiki/rest/api/space/X?expand=description.plain",
      );
      return jsonResponse(200, { key: "X" });
    });
    const client = new ConfluenceClient({
      baseUrl: "https://example.atlassian.net/wiki",
      email: "user@example.com",
      apiToken: "token",
      fetchImpl,
      maxRetries: 0,
    });
    await client.get("/rest/api/space/X", { expand: "description.plain" });
    expect(client.getSiteBaseUrl()).toBe("https://example.atlassian.net");
  });

  it("maps 401 to authentication error", async () => {
    const client = new ConfluenceClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
      fetchImpl: async () => jsonResponse(401, { message: "unauthorized" }),
      maxRetries: 0,
    });
    await expect(client.get("/rest/api/space/X")).rejects.toBeInstanceOf(
      ConfluenceAuthenticationError,
    );
  });

  it("maps 403 to authentication error", async () => {
    const client = new ConfluenceClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
      fetchImpl: async () => jsonResponse(403, { message: "forbidden" }),
      maxRetries: 0,
    });
    await expect(client.get("/rest/api/space/X")).rejects.toBeInstanceOf(
      ConfluenceAuthenticationError,
    );
  });

  it("maps 404 to not found", async () => {
    const client = new ConfluenceClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
      fetchImpl: async () => jsonResponse(404, { message: "not found" }),
      maxRetries: 0,
    });
    await expect(client.get("/rest/api/content/1")).rejects.toBeInstanceOf(ConfluenceNotFoundError);
  });

  it("maps 400 to validation error and does not retry", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, { message: "bad" }));
    const client = new ConfluenceClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
      fetchImpl,
      maxRetries: 3,
    });
    await expect(client.get("/rest/api/content/search")).rejects.toBeInstanceOf(
      ConfluenceValidationError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps 429 to rate limit and retries with Retry-After", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(429, { message: "slow down" }, { "retry-after": "0" });
      }
      return jsonResponse(200, { ok: true });
    });

    const client = new ConfluenceClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
      fetchImpl,
      maxRetries: 2,
    });

    await expect(client.get("/rest/api/space/X")).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("maps 500 without blind retry of non-gateway errors beyond policy", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { message: "boom" }));
    const client = new ConfluenceClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
      fetchImpl,
      maxRetries: 0,
    });
    await expect(client.get("/rest/api/space/X")).rejects.toMatchObject({
      status: 500,
      provider: "confluence",
    });
  });

  it("retries 503 then succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(503, { message: "unavailable" });
      }
      return jsonResponse(200, { key: "OK" });
    });
    const client = new ConfluenceClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
      fetchImpl,
      maxRetries: 2,
    });
    await expect(client.get("/rest/api/space/X")).resolves.toEqual({ key: "OK" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("maps abort to timeout error", async () => {
    const client = new ConfluenceClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
      timeoutMs: 1,
      maxRetries: 0,
      fetchImpl: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    });
    await expect(client.get("/rest/api/space/X")).rejects.toBeInstanceOf(ConfluenceTimeoutError);
  });

  it("maps network failure to unavailable", async () => {
    const client = new ConfluenceClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
      maxRetries: 0,
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(client.get("/rest/api/space/X")).rejects.toBeInstanceOf(
      ConfluenceUnavailableError,
    );
  });

  it("exposes rate limit error shape", async () => {
    const client = new ConfluenceClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
      maxRetries: 0,
      fetchImpl: async () => jsonResponse(429, { message: "slow" }, { "retry-after": "1" }),
    });
    await expect(client.get("/rest/api/space/X")).rejects.toBeInstanceOf(ConfluenceRateLimitError);
  });
});
