import { describe, expect, it } from "vitest";
import { loadMcpEnv } from "../src/config/env.config.js";
import { McpConfigurationError } from "../src/errors/mcp-errors.js";

describe("loadMcpEnv", () => {
  it("loads defaults", () => {
    const config = loadMcpEnv({});
    expect(config.MCP_SERVER_NAME).toBe("engineering-mcp");
    expect(config.MCP_SERVER_VERSION).toBe("0.1.0");
    expect(config.MCP_READ_ONLY).toBe(true);
    expect(config.LOG_LEVEL).toBe("info");
  });

  it("parses boolean flags", () => {
    const config = loadMcpEnv({
      MCP_READ_ONLY: "false",
      MCP_ALLOW_JIRA_WRITE: "true",
    });
    expect(config.MCP_READ_ONLY).toBe(false);
    expect(config.MCP_ALLOW_JIRA_WRITE).toBe(true);
  });

  it("rejects invalid LOG_LEVEL", () => {
    expect(() => loadMcpEnv({ LOG_LEVEL: "verbose" })).toThrow(McpConfigurationError);
  });
});
