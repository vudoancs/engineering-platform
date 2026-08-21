import { describe, expect, it } from "vitest";
import { loadMcpEnv } from "../src/config/env.config.js";
import { McpConfigurationError } from "../src/errors/mcp-errors.js";

describe("loadMcpEnv Jira settings", () => {
  it("allows missing Jira credentials", () => {
    const config = loadMcpEnv({});
    expect(config.JIRA_BASE_URL).toBeUndefined();
    expect(config.JIRA_REQUEST_TIMEOUT_MS).toBe(10_000);
  });

  it("rejects partial Jira credentials", () => {
    expect(() =>
      loadMcpEnv({
        JIRA_BASE_URL: "https://example.atlassian.net",
        JIRA_EMAIL: "user@example.com",
      }),
    ).toThrow(McpConfigurationError);
  });

  it("accepts complete Jira credentials", () => {
    const config = loadMcpEnv({
      JIRA_BASE_URL: "https://example.atlassian.net",
      JIRA_EMAIL: "user@example.com",
      JIRA_API_TOKEN: "token",
      JIRA_REQUEST_TIMEOUT_MS: "15000",
    });
    expect(config.JIRA_BASE_URL).toBe("https://example.atlassian.net");
    expect(config.JIRA_REQUEST_TIMEOUT_MS).toBe(15_000);
  });
});
