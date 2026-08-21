/**
 * Normalized GitHub integration errors.
 * Never include tokens, Authorization headers, or secrets.
 */

export type GitHubErrorCode =
  | "GITHUB_ERROR"
  | "GITHUB_CONFIGURATION_ERROR"
  | "GITHUB_AUTHENTICATION_ERROR"
  | "GITHUB_RATE_LIMIT_ERROR"
  | "GITHUB_NOT_FOUND"
  | "GITHUB_VALIDATION_ERROR"
  | "GITHUB_UNAVAILABLE"
  | "GITHUB_PROJECT_BOUNDARY_VIOLATION"
  | "GITHUB_REPOSITORY_BOUNDARY_VIOLATION"
  | "GITHUB_TIMEOUT"
  | "GITHUB_FILE_TOO_LARGE"
  | "GITHUB_BINARY_CONTENT";

export interface GitHubErrorOptions {
  code?: GitHubErrorCode;
  retryable?: boolean;
  cause?: unknown;
  details?: Record<string, unknown>;
  status?: number;
}

export class GitHubError extends Error {
  readonly code: GitHubErrorCode;
  readonly retryable: boolean;
  readonly provider = "github" as const;
  readonly details?: Record<string, unknown>;
  readonly status?: number;

  constructor(message: string, options: GitHubErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "GitHubError";
    this.code = options.code ?? "GITHUB_ERROR";
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

export class GitHubConfigurationError extends GitHubError {
  constructor(message: string, options: Omit<GitHubErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "GITHUB_CONFIGURATION_ERROR", retryable: false });
    this.name = "GitHubConfigurationError";
  }
}

export class GitHubAuthenticationError extends GitHubError {
  constructor(
    message = "GitHub authentication failed",
    options: Omit<GitHubErrorOptions, "code"> = {},
  ) {
    super(message, { ...options, code: "GITHUB_AUTHENTICATION_ERROR", retryable: false });
    this.name = "GitHubAuthenticationError";
  }
}

export class GitHubRateLimitError extends GitHubError {
  readonly resetAt?: string;

  constructor(
    message = "GitHub rate limit exceeded",
    options: Omit<GitHubErrorOptions, "code"> & { resetAt?: string } = {},
  ) {
    super(message, { ...options, code: "GITHUB_RATE_LIMIT_ERROR", retryable: true });
    this.name = "GitHubRateLimitError";
    if (options.resetAt !== undefined) {
      this.resetAt = options.resetAt;
    }
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      ...(this.resetAt !== undefined ? { resetAt: this.resetAt } : {}),
    };
  }
}

export class GitHubNotFoundError extends GitHubError {
  constructor(message: string, options: Omit<GitHubErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "GITHUB_NOT_FOUND", retryable: false });
    this.name = "GitHubNotFoundError";
  }
}

export class GitHubValidationError extends GitHubError {
  constructor(message: string, options: Omit<GitHubErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "GITHUB_VALIDATION_ERROR", retryable: false });
    this.name = "GitHubValidationError";
  }
}

export class GitHubUnavailableError extends GitHubError {
  constructor(
    message = "GitHub is temporarily unavailable",
    options: Omit<GitHubErrorOptions, "code"> = {},
  ) {
    super(message, { ...options, code: "GITHUB_UNAVAILABLE", retryable: true });
    this.name = "GitHubUnavailableError";
  }
}

export class GitHubProjectBoundaryError extends GitHubError {
  constructor(message: string, options: Omit<GitHubErrorOptions, "code"> = {}) {
    super(message, {
      ...options,
      code: "GITHUB_PROJECT_BOUNDARY_VIOLATION",
      retryable: false,
    });
    this.name = "GitHubProjectBoundaryError";
  }
}

export class GitHubRepositoryBoundaryError extends GitHubError {
  constructor(message: string, options: Omit<GitHubErrorOptions, "code"> = {}) {
    super(message, {
      ...options,
      code: "GITHUB_REPOSITORY_BOUNDARY_VIOLATION",
      retryable: false,
    });
    this.name = "GitHubRepositoryBoundaryError";
  }
}

export class GitHubTimeoutError extends GitHubError {
  constructor(message = "GitHub request timed out", options: Omit<GitHubErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "GITHUB_TIMEOUT", retryable: true });
    this.name = "GitHubTimeoutError";
  }
}

export class GitHubFileTooLargeError extends GitHubError {
  constructor(message: string, options: Omit<GitHubErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "GITHUB_FILE_TOO_LARGE", retryable: false });
    this.name = "GitHubFileTooLargeError";
  }
}

export class GitHubBinaryContentError extends GitHubError {
  constructor(message: string, options: Omit<GitHubErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "GITHUB_BINARY_CONTENT", retryable: false });
    this.name = "GitHubBinaryContentError";
  }
}
