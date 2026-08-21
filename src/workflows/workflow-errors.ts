export type WorkflowErrorCode =
  | "WORKFLOW_ERROR"
  | "WORKFLOW_CONFIGURATION_ERROR"
  | "WORKFLOW_VALIDATION_ERROR"
  | "WORKFLOW_NOT_FOUND"
  | "WORKFLOW_INSTANCE_NOT_FOUND"
  | "WORKFLOW_STATE_ERROR"
  | "WORKFLOW_STEP_ERROR"
  | "WORKFLOW_APPROVAL_ERROR"
  | "WORKFLOW_TIMEOUT"
  | "WORKFLOW_PROJECT_DENIED";

export interface WorkflowErrorOptions {
  code?: WorkflowErrorCode;
  cause?: unknown;
  details?: Record<string, unknown>;
  retryable?: boolean;
}

export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;
  readonly retryable: boolean;
  readonly provider = "workflows" as const;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: WorkflowErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "WorkflowError";
    this.code = options.code ?? "WORKFLOW_ERROR";
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

export class WorkflowConfigurationError extends WorkflowError {
  constructor(message: string, options: Omit<WorkflowErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "WORKFLOW_CONFIGURATION_ERROR", retryable: false });
    this.name = "WorkflowConfigurationError";
  }
}

export class WorkflowValidationError extends WorkflowError {
  constructor(message: string, options: Omit<WorkflowErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "WORKFLOW_VALIDATION_ERROR", retryable: false });
    this.name = "WorkflowValidationError";
  }
}

export class WorkflowNotFoundError extends WorkflowError {
  constructor(workflowId: string) {
    super(`Workflow "${workflowId}" was not found.`, {
      code: "WORKFLOW_NOT_FOUND",
      details: { workflowId },
      retryable: false,
    });
    this.name = "WorkflowNotFoundError";
  }
}

export class WorkflowInstanceNotFoundError extends WorkflowError {
  constructor(instanceId: string) {
    super(`Workflow instance "${instanceId}" was not found.`, {
      code: "WORKFLOW_INSTANCE_NOT_FOUND",
      details: { instanceId },
      retryable: false,
    });
    this.name = "WorkflowInstanceNotFoundError";
  }
}

export class WorkflowTimeoutError extends WorkflowError {
  constructor(stepId: string, timeoutMs: number) {
    super(`Step "${stepId}" timed out after ${timeoutMs}ms.`, {
      code: "WORKFLOW_TIMEOUT",
      details: { stepId, timeoutMs },
      retryable: true,
    });
    this.name = "WorkflowTimeoutError";
  }
}
