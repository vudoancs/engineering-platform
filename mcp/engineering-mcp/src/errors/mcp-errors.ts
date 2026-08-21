/**
 * Normalized MCP foundation errors.
 * Never include secrets, tokens, or credentials in error messages.
 */

export type McpErrorCode =
  | "MCP_ERROR"
  | "MCP_CONFIGURATION_ERROR"
  | "MCP_PERMISSION_ERROR"
  | "MCP_TOOL_NOT_FOUND"
  | "MCP_RESOURCE_NOT_FOUND"
  | "MCP_PROJECT_NOT_FOUND"
  | "MCP_VALIDATION_ERROR";

export interface McpErrorOptions {
  code?: McpErrorCode;
  retryable?: boolean;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class McpError extends Error {
  readonly code: McpErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: McpErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "McpError";
    this.code = options.code ?? "MCP_ERROR";
    this.retryable = options.retryable ?? false;
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

export class McpConfigurationError extends McpError {
  constructor(message: string, options: Omit<McpErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "MCP_CONFIGURATION_ERROR", retryable: false });
    this.name = "McpConfigurationError";
  }
}

export class McpPermissionError extends McpError {
  constructor(message: string, options: Omit<McpErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "MCP_PERMISSION_ERROR", retryable: false });
    this.name = "McpPermissionError";
  }
}

export class McpToolNotFoundError extends McpError {
  constructor(toolName: string, options: Omit<McpErrorOptions, "code"> = {}) {
    super(`Tool not found: "${toolName}"`, {
      ...options,
      code: "MCP_TOOL_NOT_FOUND",
      retryable: false,
      details: { ...(options.details ?? {}), toolName },
    });
    this.name = "McpToolNotFoundError";
  }
}

export class McpResourceNotFoundError extends McpError {
  constructor(resourceId: string, options: Omit<McpErrorOptions, "code"> = {}) {
    super(`Resource not found: "${resourceId}"`, {
      ...options,
      code: "MCP_RESOURCE_NOT_FOUND",
      retryable: false,
      details: { ...(options.details ?? {}), resourceId },
    });
    this.name = "McpResourceNotFoundError";
  }
}

export class McpProjectNotFoundError extends McpError {
  constructor(projectId: string, options: Omit<McpErrorOptions, "code"> = {}) {
    super(`Project not found: "${projectId}"`, {
      ...options,
      code: "MCP_PROJECT_NOT_FOUND",
      retryable: false,
      details: { ...(options.details ?? {}), projectId },
    });
    this.name = "McpProjectNotFoundError";
  }
}
