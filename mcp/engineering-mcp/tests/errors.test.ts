import { describe, expect, it } from "vitest";
import {
  McpError,
  McpPermissionError,
  McpToolNotFoundError,
} from "../src/errors/mcp-errors.js";

describe("MCP errors", () => {
  it("includes code and retryable on McpError", () => {
    const error = new McpError("boom", { code: "MCP_VALIDATION_ERROR", retryable: true });
    expect(error.code).toBe("MCP_VALIDATION_ERROR");
    expect(error.retryable).toBe(true);
    expect(error.message).toBe("boom");
  });

  it("creates McpToolNotFoundError with tool name", () => {
    const error = new McpToolNotFoundError("demo");
    expect(error.code).toBe("MCP_TOOL_NOT_FOUND");
    expect(error.message).toContain("demo");
    expect(error.retryable).toBe(false);
  });

  it("creates McpPermissionError", () => {
    const error = new McpPermissionError("denied");
    expect(error).toBeInstanceOf(McpError);
    expect(error.code).toBe("MCP_PERMISSION_ERROR");
  });
});
