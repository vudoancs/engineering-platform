export type CostErrorCode =
  | "COST_ERROR"
  | "COST_CONFIG_ERROR"
  | "BUDGET_BLOCKED"
  | "MISSING_PROJECT"
  | "UNAUTHORIZED_COST_VIEW"
  | "UNKNOWN_MODEL_PRICING"
  | "INVALID_USAGE";

export interface CostErrorOptions {
  code?: CostErrorCode;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class CostError extends Error {
  readonly code: CostErrorCode;
  readonly retryable = false;
  readonly provider = "cost" as const;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: CostErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "CostError";
    this.code = options.code ?? "COST_ERROR";
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

function opts(code: CostErrorCode, details?: Record<string, unknown>): CostErrorOptions {
  return details !== undefined ? { code, details } : { code };
}

export class CostConfigurationError extends CostError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, opts("COST_CONFIG_ERROR", details));
    this.name = "CostConfigurationError";
  }
}

export class BudgetBlockedError extends CostError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, opts("BUDGET_BLOCKED", details));
    this.name = "BudgetBlockedError";
  }
}

export class MissingProjectError extends CostError {
  constructor(message = "projectId is required for AI cost tracking") {
    super(message, opts("MISSING_PROJECT"));
    this.name = "MissingProjectError";
  }
}

export class UnauthorizedCostViewError extends CostError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, opts("UNAUTHORIZED_COST_VIEW", details));
    this.name = "UnauthorizedCostViewError";
  }
}

export class UnknownModelPricingError extends CostError {
  constructor(provider: string, model: string) {
    super(`No pricing configured for ${provider}/${model}`, {
      code: "UNKNOWN_MODEL_PRICING",
      details: { provider, model },
    });
    this.name = "UnknownModelPricingError";
  }
}
