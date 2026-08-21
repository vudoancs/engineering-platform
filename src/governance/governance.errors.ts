/**
 * Governance errors — fail closed, never expose secrets.
 */

export type GovernanceErrorCode =
  | "GOVERNANCE_ERROR"
  | "GOVERNANCE_CONFIGURATION_ERROR"
  | "GOVERNANCE_VALIDATION_ERROR"
  | "GOVERNANCE_DENIED";

export interface GovernanceErrorOptions {
  code?: GovernanceErrorCode;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class GovernanceError extends Error {
  readonly code: GovernanceErrorCode;
  readonly retryable = false;
  readonly provider = "governance" as const;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: GovernanceErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "GovernanceError";
    this.code = options.code ?? "GOVERNANCE_ERROR";
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

export class GovernanceConfigurationError extends GovernanceError {
  constructor(message: string, options: Omit<GovernanceErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "GOVERNANCE_CONFIGURATION_ERROR" });
    this.name = "GovernanceConfigurationError";
  }
}

export class GovernanceValidationError extends GovernanceError {
  constructor(message: string, options: Omit<GovernanceErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "GOVERNANCE_VALIDATION_ERROR" });
    this.name = "GovernanceValidationError";
  }
}
