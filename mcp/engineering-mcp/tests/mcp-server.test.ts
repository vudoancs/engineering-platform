import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { McpServerFactory } from "../src/server/mcp-server.js";
import { Logger } from "../src/services/logger.js";
import { CONFLUENCE_TOOL_NAMES } from "../src/tools/confluence/index.js";
import { ENGINEERING_TOOL_NAMES } from "../src/tools/engineering/index.js";
import { GOVERNANCE_TOOL_NAMES } from "../src/tools/governance/index.js";
import { GITHUB_TOOL_NAMES } from "../src/tools/github/index.js";
import { JIRA_TOOL_NAMES } from "../src/tools/jira/index.js";
import { ToolRegistry } from "../src/server/tool-registry.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const projectsDir = path.join(root, "projects");
const policiesDir = path.join(root, "policies");

describe("McpServerFactory", () => {
  it("registers read-only integration, intelligence, and governance tools", () => {
    const factory = new McpServerFactory();
    const runtime = factory.create({
      projectsDir,
      policiesDir,
      env: {
        MCP_SERVER_NAME: "engineering-mcp",
        MCP_SERVER_VERSION: "0.1.0",
        MCP_READ_ONLY: "true",
        LOG_LEVEL: "error",
      },
      logger: new Logger({ level: "error", sink: () => undefined }),
    });

    const names = runtime.tools.list().map((tool) => tool.name).sort();
    const expected = [
      ...JIRA_TOOL_NAMES,
      ...GITHUB_TOOL_NAMES,
      ...CONFLUENCE_TOOL_NAMES,
      ...ENGINEERING_TOOL_NAMES,
      ...GOVERNANCE_TOOL_NAMES,
    ].sort();
    expect(runtime.tools.size()).toBe(expected.length);
    expect(names).toEqual(expected);
    expect(names).toContain("engineering_check_permission");
    expect(names.some((name) => name.includes("create"))).toBe(false);
    expect(names.some((name) => name.includes("delete"))).toBe(false);
    expect(names.some((name) => name.includes("merge"))).toBe(false);
    expect(runtime.governance).toBeDefined();
    expect(runtime.governance.isFailClosed()).toBe(true);
  });

  it("allows injecting an empty tool registry", () => {
    const factory = new McpServerFactory();
    const runtime = factory.create({
      projectsDir,
      policiesDir,
      toolRegistry: new ToolRegistry(),
      logger: new Logger({ level: "error", sink: () => undefined }),
    });
    expect(runtime.tools.size()).toBe(0);
  });

  it("server is not connected until STDIO transport is attached", () => {
    const factory = new McpServerFactory();
    const runtime = factory.create({
      projectsDir,
      policiesDir,
      logger: new Logger({ level: "error", sink: () => undefined }),
    });
    expect(runtime.server.isConnected()).toBe(false);
  });
});
