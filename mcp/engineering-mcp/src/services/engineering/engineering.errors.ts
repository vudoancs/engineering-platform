/**
 * Engineering Intelligence errors (domain layer — not an HTTP integration).
 */

export type EngineeringErrorCode =
  | "ENGINEERING_ERROR"
  | "ENGINEERING_VALIDATION_ERROR"
  | "ENGINEERING_PROJECT_NOT_FOUND";

export interface EngineeringErrorOptions {
  code?: EngineeringErrorCode;
  retryable?: boolean;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class EngineeringError extends Error {
  readonly code: EngineeringErrorCode;
  readonly retryable: boolean;
  readonly provider = "engineering" as const;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: EngineeringErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "EngineeringError";
    this.code = options.code ?? "ENGINEERING_ERROR";
    this.retryable = options.retryable ?? false;
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

export class EngineeringValidationError extends EngineeringError {
  constructor(message: string, options: Omit<EngineeringErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "ENGINEERING_VALIDATION_ERROR", retryable: false });
    this.name = "EngineeringValidationError";
  }
}
