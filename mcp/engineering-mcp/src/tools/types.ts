import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { ToolContext } from "./tool-context.js";

/**
 * Internal tool definition used by ToolRegistry.
 * Handlers are registered onto the official MCP SDK McpServer.
 */
export interface EngineeringTool<TInput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  execute: (context: ToolContext, input: TInput) => Promise<CallToolResult> | CallToolResult;
}
