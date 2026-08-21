export type ExecutionErrorCode =
  | "EXECUTION_ERROR"
  | "PROJECT_ACCESS_DENIED"
  | "ACTION_NOT_ALLOWED"
  | "GOVERNANCE_DENIED"
  | "APPROVAL_REQUIRED"
  | "RESOURCE_OUT_OF_SCOPE"
  | "DUPLICATE_EXECUTION"
  | "INVALID_PARAMETERS"
  | "EXTERNAL_SERVICE_ERROR"
  | "UNAUTHORIZED_AGENT";

export interface ExecutionErrorOptions {
  code?: ExecutionErrorCode;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class ExecutionError extends Error {
  readonly code: ExecutionErrorCode;
  readonly retryable = false;
  readonly provider = "execution" as const;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: ExecutionErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ExecutionError";
    this.code = options.code ?? "EXECUTION_ERROR";
    if (options.details !== undefined) {
      this.details = sanitizeDetails(options.details);
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

function subclass(
  code: ExecutionErrorCode,
  details?: Record<string, unknown>,
): ExecutionErrorOptions {
  return details !== undefined ? { code, details } : { code };
}

export class ProjectAccessDeniedError extends ExecutionError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, subclass("PROJECT_ACCESS_DENIED", details));
    this.name = "ProjectAccessDeniedError";
  }
}

export class ActionNotAllowedError extends ExecutionError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, subclass("ACTION_NOT_ALLOWED", details));
    this.name = "ActionNotAllowedError";
  }
}

export class GovernanceDeniedError extends ExecutionError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, subclass("GOVERNANCE_DENIED", details));
    this.name = "GovernanceDeniedError";
  }
}

export class ApprovalRequiredError extends ExecutionError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, subclass("APPROVAL_REQUIRED", details));
    this.name = "ApprovalRequiredError";
  }
}

export class ResourceOutOfScopeError extends ExecutionError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, subclass("RESOURCE_OUT_OF_SCOPE", details));
    this.name = "ResourceOutOfScopeError";
  }
}

export class DuplicateExecutionError extends ExecutionError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, subclass("DUPLICATE_EXECUTION", details));
    this.name = "DuplicateExecutionError";
  }
}

export class InvalidParametersError extends ExecutionError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, subclass("INVALID_PARAMETERS", details));
    this.name = "InvalidParametersError";
  }
}

export class ExternalServiceError extends ExecutionError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, subclass("EXTERNAL_SERVICE_ERROR", details));
    this.name = "ExternalServiceError";
  }
}

export class UnauthorizedAgentError extends ExecutionError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, subclass("UNAUTHORIZED_AGENT", details));
    this.name = "UnauthorizedAgentError";
  }
}

const SECRET_KEY = /(password|secret|token|api[_-]?key|authorization|credential|accessToken)/i;

function sanitizeDetails(
  details: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = value;
  }
  return out;
}
