/**
 * Normalized Jira integration errors.
 * Never include API tokens, Authorization headers, or raw auth payloads.
 */

export type JiraErrorCode =
  | "JIRA_ERROR"
  | "JIRA_CONFIGURATION_ERROR"
  | "JIRA_AUTHENTICATION_ERROR"
  | "JIRA_RATE_LIMIT_ERROR"
  | "JIRA_NOT_FOUND"
  | "JIRA_VALIDATION_ERROR"
  | "JIRA_UNAVAILABLE"
  | "JIRA_PROJECT_BOUNDARY_VIOLATION"
  | "JIRA_TIMEOUT";

export interface JiraErrorOptions {
  code?: JiraErrorCode;
  retryable?: boolean;
  cause?: unknown;
  details?: Record<string, unknown>;
  status?: number;
}

export class JiraError extends Error {
  readonly code: JiraErrorCode;
  readonly retryable: boolean;
  readonly provider = "jira" as const;
  readonly details?: Record<string, unknown>;
  readonly status?: number;

  constructor(message: string, options: JiraErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JiraError";
    this.code = options.code ?? "JIRA_ERROR";
    this.retryable = options.retryable ?? false;
    if (options.details !== undefined) {
      this.details = options.details;
    }
    if (options.status !== undefined) {
      this.status = options.status;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      provider: this.provider,
      ...(this.status !== undefined ? { status: this.status } : {}),
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export class JiraConfigurationError extends JiraError {
  constructor(message: string, options: Omit<JiraErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "JIRA_CONFIGURATION_ERROR", retryable: false });
    this.name = "JiraConfigurationError";
  }
}

export class JiraAuthenticationError extends JiraError {
  constructor(message = "Jira authentication failed", options: Omit<JiraErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "JIRA_AUTHENTICATION_ERROR", retryable: false });
    this.name = "JiraAuthenticationError";
  }
}

export class JiraRateLimitError extends JiraError {
  readonly retryAfterMs?: number;

  constructor(
    message = "Jira rate limit exceeded",
    options: Omit<JiraErrorOptions, "code"> & { retryAfterMs?: number } = {},
  ) {
    super(message, { ...options, code: "JIRA_RATE_LIMIT_ERROR", retryable: true });
    this.name = "JiraRateLimitError";
    if (options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs;
    }
  }
}

export class JiraNotFoundError extends JiraError {
  constructor(message: string, options: Omit<JiraErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "JIRA_NOT_FOUND", retryable: false });
    this.name = "JiraNotFoundError";
  }
}

export class JiraValidationError extends JiraError {
  constructor(message: string, options: Omit<JiraErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "JIRA_VALIDATION_ERROR", retryable: false });
    this.name = "JiraValidationError";
  }
}

export class JiraUnavailableError extends JiraError {
  constructor(message = "Jira is temporarily unavailable", options: Omit<JiraErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "JIRA_UNAVAILABLE", retryable: true });
    this.name = "JiraUnavailableError";
  }
}

export class JiraProjectBoundaryError extends JiraError {
  constructor(message: string, options: Omit<JiraErrorOptions, "code"> = {}) {
    super(message, {
      ...options,
      code: "JIRA_PROJECT_BOUNDARY_VIOLATION",
      retryable: false,
    });
    this.name = "JiraProjectBoundaryError";
  }
}

export class JiraTimeoutError extends JiraError {
  constructor(message = "Jira request timed out", options: Omit<JiraErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "JIRA_TIMEOUT", retryable: true });
    this.name = "JiraTimeoutError";
  }
}
