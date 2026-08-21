import { describe, expect, it, vi } from "vitest";
import { GitHubClient } from "../src/integrations/github/github.client.js";
import {
  GitHubAuthenticationError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubTimeoutError,
} from "../src/integrations/github/github.errors.js";

function jsonResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
  });
}

describe("GitHubClient", () => {
  it("sends bearer auth and API version headers", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    const client = new GitHubClient({
      token: "ghp_secret",
      fetchImpl,
      maxRetries: 0,
    });

    await expect(client.get("/user")).resolves.toEqual({ ok: true });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghp_secret");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("maps 401 to authentication error", async () => {
    const client = new GitHubClient({
      token: "token",
      fetchImpl: async () => jsonResponse(401, { message: "bad credentials" }),
      maxRetries: 0,
    });
    await expect(client.get("/user")).rejects.toBeInstanceOf(GitHubAuthenticationError);
  });

  it("maps 404 to not found", async () => {
    const client = new GitHubClient({
      token: "token",
      fetchImpl: async () => jsonResponse(404, { message: "Not Found" }),
      maxRetries: 0,
    });
    await expect(client.get("/repos/a/b")).rejects.toBeInstanceOf(GitHubNotFoundError);
  });

  it("maps rate-limit 403", async () => {
    const client = new GitHubClient({
      token: "token",
      fetchImpl: async () =>
        jsonResponse(
          403,
          { message: "API rate limit exceeded" },
          { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1700000000" },
        ),
      maxRetries: 0,
    });
    await expect(client.get("/user")).rejects.toBeInstanceOf(GitHubRateLimitError);
  });

  it("retries 503 then succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(503, { message: "unavailable" });
      }
      return jsonResponse(200, { ok: true });
    });
    const client = new GitHubClient({ token: "token", fetchImpl, maxRetries: 2 });
    await expect(client.get("/user")).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("maps abort to timeout", async () => {
    const client = new GitHubClient({
      token: "token",
      maxRetries: 0,
      fetchImpl: async () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      },
    });
    await expect(client.get("/user")).rejects.toBeInstanceOf(GitHubTimeoutError);
  });

  it("maps 500 to generic GitHubError", async () => {
    const client = new GitHubClient({
      token: "token",
      maxRetries: 0,
      fetchImpl: async () => jsonResponse(500, { message: "boom" }),
    });
    await expect(client.get("/user")).rejects.toMatchObject({
      name: "GitHubError",
      status: 500,
      retryable: true,
    });
  });
});
