/**
 * Normalized Confluence integration errors.
 * Never include API tokens, Authorization headers, or credentials.
 */

export type ConfluenceErrorCode =
  | "CONFLUENCE_ERROR"
  | "CONFLUENCE_CONFIGURATION_ERROR"
  | "CONFLUENCE_AUTHENTICATION_ERROR"
  | "CONFLUENCE_RATE_LIMIT_ERROR"
  | "CONFLUENCE_NOT_FOUND"
  | "CONFLUENCE_VALIDATION_ERROR"
  | "CONFLUENCE_UNAVAILABLE"
  | "CONFLUENCE_PROJECT_BOUNDARY_VIOLATION"
  | "CONFLUENCE_TIMEOUT";

export interface ConfluenceErrorOptions {
  code?: ConfluenceErrorCode;
  retryable?: boolean;
  cause?: unknown;
  details?: Record<string, unknown>;
  status?: number;
}

export class ConfluenceError extends Error {
  readonly code: ConfluenceErrorCode;
  readonly retryable: boolean;
  readonly provider = "confluence" as const;
  readonly details?: Record<string, unknown>;
  readonly status?: number;

  constructor(message: string, options: ConfluenceErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ConfluenceError";
    this.code = options.code ?? "CONFLUENCE_ERROR";
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

export class ConfluenceConfigurationError extends ConfluenceError {
  constructor(message: string, options: Omit<ConfluenceErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "CONFLUENCE_CONFIGURATION_ERROR", retryable: false });
    this.name = "ConfluenceConfigurationError";
  }
}

export class ConfluenceAuthenticationError extends ConfluenceError {
  constructor(
    message = "Confluence authentication failed",
    options: Omit<ConfluenceErrorOptions, "code"> = {},
  ) {
    super(message, { ...options, code: "CONFLUENCE_AUTHENTICATION_ERROR", retryable: false });
    this.name = "ConfluenceAuthenticationError";
  }
}

export class ConfluenceRateLimitError extends ConfluenceError {
  readonly retryAfterMs?: number;

  constructor(
    message = "Confluence rate limit exceeded",
    options: Omit<ConfluenceErrorOptions, "code"> & { retryAfterMs?: number } = {},
  ) {
    super(message, { ...options, code: "CONFLUENCE_RATE_LIMIT_ERROR", retryable: true });
    this.name = "ConfluenceRateLimitError";
    if (options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs;
    }
  }
}

export class ConfluenceNotFoundError extends ConfluenceError {
  constructor(message: string, options: Omit<ConfluenceErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "CONFLUENCE_NOT_FOUND", retryable: false });
    this.name = "ConfluenceNotFoundError";
  }
}

export class ConfluenceValidationError extends ConfluenceError {
  constructor(message: string, options: Omit<ConfluenceErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "CONFLUENCE_VALIDATION_ERROR", retryable: false });
    this.name = "ConfluenceValidationError";
  }
}

export class ConfluenceUnavailableError extends ConfluenceError {
  constructor(
    message = "Confluence is temporarily unavailable",
    options: Omit<ConfluenceErrorOptions, "code"> = {},
  ) {
    super(message, { ...options, code: "CONFLUENCE_UNAVAILABLE", retryable: true });
    this.name = "ConfluenceUnavailableError";
  }
}

export class ConfluenceProjectBoundaryError extends ConfluenceError {
  constructor(message: string, options: Omit<ConfluenceErrorOptions, "code"> = {}) {
    super(message, {
      ...options,
      code: "CONFLUENCE_PROJECT_BOUNDARY_VIOLATION",
      retryable: false,
    });
    this.name = "ConfluenceProjectBoundaryError";
  }
}

export class ConfluenceTimeoutError extends ConfluenceError {
  constructor(
    message = "Confluence request timed out",
    options: Omit<ConfluenceErrorOptions, "code"> = {},
  ) {
    super(message, { ...options, code: "CONFLUENCE_TIMEOUT", retryable: true });
    this.name = "ConfluenceTimeoutError";
  }
}
