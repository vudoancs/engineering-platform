import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { McpServerFactory } from "../src/server/mcp-server.js";
import { Logger } from "../src/services/logger.js";

const projectsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../projects",
);

describe("McpServerFactory", () => {
  it("creates MCP server with expected metadata and zero business tools", () => {
    const factory = new McpServerFactory();
    const runtime = factory.create({
      projectsDir,
      env: {
        MCP_SERVER_NAME: "engineering-mcp",
        MCP_SERVER_VERSION: "0.1.0",
        MCP_READ_ONLY: "true",
        LOG_LEVEL: "error",
      },
      logger: new Logger({ level: "error", sink: () => undefined }),
    });

    expect(runtime.config.MCP_SERVER_NAME).toBe("engineering-mcp");
    expect(runtime.config.MCP_SERVER_VERSION).toBe("0.1.0");
    expect(runtime.tools.size()).toBe(0);
    expect(runtime.resources.size()).toBe(0);
    expect(runtime.health.health().status).toBe("ok");
    expect(runtime.server).toBeDefined();
  });

  it("server is not connected until STDIO transport is attached", () => {
    const factory = new McpServerFactory();
    const runtime = factory.create({
      projectsDir,
      logger: new Logger({ level: "error", sink: () => undefined }),
    });
    expect(runtime.server.isConnected()).toBe(false);
  });
});
