import { describe, expect, it } from "vitest";
import { z } from "zod";
import { McpError, McpToolNotFoundError } from "../src/errors/mcp-errors.js";
import { ToolRegistry } from "../src/server/tool-registry.js";
import type { EngineeringTool } from "../src/tools/types.js";

const demoTool: EngineeringTool<{ value: string }> = {
  name: "demo",
  description: "demo tool",
  inputSchema: z.object({ value: z.string() }),
  execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
};

describe("ToolRegistry", () => {
  it("registers and lists tools", () => {
    const registry = new ToolRegistry();
    registry.register(demoTool);
    expect(registry.size()).toBe(1);
    expect(registry.get("demo").name).toBe("demo");
    expect(registry.list()).toHaveLength(1);
  });

  it("rejects duplicate tool names", () => {
    const registry = new ToolRegistry();
    registry.register(demoTool);
    expect(() => registry.register(demoTool)).toThrow(McpError);
    expect(() => registry.register(demoTool)).toThrow(/Duplicate tool/);
  });

  it("throws McpToolNotFoundError", () => {
    const registry = new ToolRegistry();
    expect(() => registry.get("missing")).toThrow(McpToolNotFoundError);
  });
});
