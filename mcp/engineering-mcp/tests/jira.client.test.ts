import { describe, expect, it, vi } from "vitest";
import { JiraClient } from "../src/integrations/jira/jira.client.js";
import {
  JiraAuthenticationError,
  JiraNotFoundError,
  JiraRateLimitError,
  JiraTimeoutError,
  JiraUnavailableError,
} from "../src/integrations/jira/jira.errors.js";

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
  });
}

describe("JiraClient", () => {
  it("sends authenticated GET requests", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    const client = new JiraClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
      fetchImpl,
      maxRetries: 0,
    });

    await expect(client.get("/rest/api/3/myself")).resolves.toEqual({ ok: true });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.headers)).not.toContain("token");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization?.startsWith("Basic ")).toBe(true);
  });

  it("maps 401 to authentication error", async () => {
    const client = new JiraClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
      fetchImpl: async () => jsonResponse(401, { message: "unauthorized" }),
      maxRetries: 0,
    });
    await expect(client.get("/rest/api/3/myself")).rejects.toBeInstanceOf(
      JiraAuthenticationError,
    );
  });

  it("maps 404 to not found", async () => {
    const client = new JiraClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
      fetchImpl: async () => jsonResponse(404, { errorMessages: ["not found"] }),
      maxRetries: 0,
    });
    await expect(client.get("/rest/api/3/issue/X-1")).rejects.toBeInstanceOf(JiraNotFoundError);
  });

  it("maps 429 to rate limit and retries", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(429, { message: "slow down" }, { "retry-after": "0" });
      }
      return jsonResponse(200, { ok: true });
    });

    const client = new JiraClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
      fetchImpl,
      maxRetries: 2,
    });

    await expect(client.get("/rest/api/3/myself")).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("maps 500 to unavailable and retries then fails", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { message: "down" }));
    const client = new JiraClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
      fetchImpl,
      maxRetries: 1,
    });

    await expect(client.get("/rest/api/3/myself")).rejects.toBeInstanceOf(
      JiraUnavailableError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("maps abort to timeout", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    const client = new JiraClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
      fetchImpl,
      maxRetries: 0,
    });
    await expect(client.get("/rest/api/3/myself")).rejects.toBeInstanceOf(JiraTimeoutError);
  });

  it("does not expose credentials in rate limit error JSON", async () => {
    const client = new JiraClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "super-secret-token",
      fetchImpl: async () => jsonResponse(429, { message: "Basic super-secret-token" }),
      maxRetries: 0,
    });

    try {
      await client.get("/rest/api/3/myself");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(JiraRateLimitError);
      expect(JSON.stringify(error)).not.toContain("super-secret-token");
    }
  });
});
