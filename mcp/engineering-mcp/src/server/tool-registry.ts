import { McpError, McpToolNotFoundError } from "../errors/mcp-errors.js";
import type { EngineeringTool } from "../tools/types.js";

/**
 * Modular tool registration. Future tools live under tools/{jira,github,...}.
 * No business tools are registered in the foundation.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, EngineeringTool>();

  register(tool: EngineeringTool): void {
    if (this.tools.has(tool.name)) {
      throw new McpError(`Duplicate tool registration rejected: "${tool.name}"`, {
        code: "MCP_VALIDATION_ERROR",
        details: { toolName: tool.name },
      });
    }

    this.tools.set(tool.name, tool);
  }

  get(name: string): EngineeringTool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new McpToolNotFoundError(name);
    }
    return tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): EngineeringTool[] {
    return [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  size(): number {
    return this.tools.size;
  }

  clear(): void {
    this.tools.clear();
  }
}
