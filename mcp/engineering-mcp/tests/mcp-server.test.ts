import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { McpServerFactory } from "../src/server/mcp-server.js";
import { Logger } from "../src/services/logger.js";
import { JIRA_TOOL_NAMES } from "../src/tools/jira/index.js";
import { ToolRegistry } from "../src/server/tool-registry.js";

const projectsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../projects",
);

describe("McpServerFactory", () => {
  it("creates MCP server and registers read-only Jira tools", () => {
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
    expect(runtime.tools.size()).toBe(JIRA_TOOL_NAMES.length);
    expect(runtime.tools.list().map((tool) => tool.name).sort()).toEqual(
      [...JIRA_TOOL_NAMES].sort(),
    );
    expect(runtime.tools.list().some((tool) => tool.name.includes("create"))).toBe(
      false,
    );
    expect(runtime.tools.list().some((tool) => tool.name.includes("update"))).toBe(
      false,
    );
    expect(runtime.tools.list().some((tool) => tool.name.includes("transition_issue"))).toBe(
      false,
    );
    expect(runtime.tools.list().some((tool) => tool.name.includes("delete"))).toBe(
      false,
    );
    expect(runtime.resources.size()).toBe(0);
    expect(runtime.health.health().status).toBe("ok");
    expect(runtime.jira.isConfigured()).toBe(false);
    expect(runtime.server).toBeDefined();
  });

  it("allows injecting an empty tool registry", () => {
    const factory = new McpServerFactory();
    const runtime = factory.create({
      projectsDir,
      toolRegistry: new ToolRegistry(),
      logger: new Logger({ level: "error", sink: () => undefined }),
    });
    expect(runtime.tools.size()).toBe(0);
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
