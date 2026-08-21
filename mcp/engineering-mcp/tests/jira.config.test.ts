import { describe, expect, it } from "vitest";
import { loadMcpEnv } from "../src/config/env.config.js";
import { McpConfigurationError } from "../src/errors/mcp-errors.js";

describe("loadMcpEnv Jira/GitHub settings", () => {
  it("allows missing Jira credentials", () => {
    const config = loadMcpEnv({});
    expect(config.JIRA_BASE_URL).toBeUndefined();
    expect(config.JIRA_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(config.GITHUB_API_URL).toBe("https://api.github.com");
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

  it("accepts GitHub token configuration", () => {
    const config = loadMcpEnv({
      GITHUB_TOKEN: "ghp_test",
      GITHUB_API_URL: "https://api.github.com",
      GITHUB_REQUEST_TIMEOUT_MS: "12000",
    });
    expect(config.GITHUB_TOKEN).toBe("ghp_test");
    expect(config.GITHUB_API_URL).toBe("https://api.github.com");
    expect(config.GITHUB_REQUEST_TIMEOUT_MS).toBe(12_000);
  });

  it("allows missing Confluence credentials", () => {
    const config = loadMcpEnv({});
    expect(config.CONFLUENCE_BASE_URL).toBeUndefined();
    expect(config.CONFLUENCE_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(config.CONFLUENCE_MAX_PAGE_SIZE_BYTES).toBe(204_800);
  });

  it("rejects partial Confluence credentials", () => {
    expect(() =>
      loadMcpEnv({
        CONFLUENCE_BASE_URL: "https://example.atlassian.net",
        CONFLUENCE_EMAIL: "user@example.com",
      }),
    ).toThrow(McpConfigurationError);
  });

  it("accepts complete Confluence credentials", () => {
    const config = loadMcpEnv({
      CONFLUENCE_BASE_URL: "https://example.atlassian.net",
      CONFLUENCE_EMAIL: "user@example.com",
      CONFLUENCE_API_TOKEN: "token",
      CONFLUENCE_REQUEST_TIMEOUT_MS: "8000",
      CONFLUENCE_MAX_PAGE_SIZE_BYTES: "102400",
    });
    expect(config.CONFLUENCE_BASE_URL).toBe("https://example.atlassian.net");
    expect(config.CONFLUENCE_REQUEST_TIMEOUT_MS).toBe(8_000);
    expect(config.CONFLUENCE_MAX_PAGE_SIZE_BYTES).toBe(102_400);
  });
});
