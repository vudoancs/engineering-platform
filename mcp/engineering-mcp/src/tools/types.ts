import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { ToolContext } from "./tool-context.js";

/**
 * Internal tool definition used by ToolRegistry.
 * Handlers are registered onto the official MCP SDK McpServer.
 */
export interface EngineeringTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  execute: (context: ToolContext, input: unknown) => Promise<CallToolResult> | CallToolResult;
}
