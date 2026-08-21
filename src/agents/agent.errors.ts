/**
 * Agent layer errors — fail closed.
 */

export type AgentErrorCode =
  | "AGENT_ERROR"
  | "AGENT_CONFIGURATION_ERROR"
  | "AGENT_VALIDATION_ERROR"
  | "AGENT_NOT_FOUND"
  | "AGENT_TOOL_DENIED"
  | "AGENT_PROJECT_DENIED";

export interface AgentErrorOptions {
  code?: AgentErrorCode;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly retryable = false;
  readonly provider = "agents" as const;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: AgentErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AgentError";
    this.code = options.code ?? "AGENT_ERROR";
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      provider: this.provider,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export class AgentConfigurationError extends AgentError {
  constructor(message: string, options: Omit<AgentErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "AGENT_CONFIGURATION_ERROR" });
    this.name = "AgentConfigurationError";
  }
}

export class AgentValidationError extends AgentError {
  constructor(message: string, options: Omit<AgentErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "AGENT_VALIDATION_ERROR" });
    this.name = "AgentValidationError";
  }
}

export class AgentNotFoundError extends AgentError {
  constructor(agentId: string, options: Omit<AgentErrorOptions, "code"> = {}) {
    super(`Agent "${agentId}" was not found.`, {
      ...options,
      code: "AGENT_NOT_FOUND",
      details: { ...(options.details ?? {}), agentId },
    });
    this.name = "AgentNotFoundError";
  }
}

export class AgentToolDeniedError extends AgentError {
  constructor(agentId: string, toolName: string, reason: string) {
    super(reason, {
      code: "AGENT_TOOL_DENIED",
      details: { agentId, toolName },
    });
    this.name = "AgentToolDeniedError";
  }
}

export class AgentProjectDeniedError extends AgentError {
  constructor(projectId: string, reason: string) {
    super(reason, {
      code: "AGENT_PROJECT_DENIED",
      details: { projectId },
    });
    this.name = "AgentProjectDeniedError";
  }
}
