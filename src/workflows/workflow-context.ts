import { WorkflowValidationError } from "./workflow-errors.js";
import type { WorkflowContext } from "./workflow.types.js";

const SECRET_KEY_PATTERN = /(password|secret|token|api[_-]?key|authorization|credential)/i;

/**
 * Build / validate serializable workflow context. Rejects secrets by key name.
 */
export function createWorkflowContext(
  input: Omit<WorkflowContext, "variables"> & { variables?: Record<string, unknown> },
): WorkflowContext {
  const projectId = input.projectId?.trim() ?? "";
  if (!projectId) {
    throw new WorkflowValidationError("projectId is required on workflow context");
  }

  const variables = input.variables ?? {};
  assertNoSecrets(variables);

  const context: WorkflowContext = {
    projectId,
    variables: structuredClone(variables) as Record<string, unknown>,
  };
  if (input.issueKey !== undefined) context.issueKey = input.issueKey;
  if (input.repository !== undefined) context.repository = input.repository;
  if (input.branch !== undefined) context.branch = input.branch;
  if (input.pullRequestNumber !== undefined) {
    context.pullRequestNumber = input.pullRequestNumber;
  }
  if (input.actor !== undefined) context.actor = input.actor;
  return context;
}

export function assertProjectIdImmutable(
  originalProjectId: string,
  context: WorkflowContext,
): void {
  if (context.projectId !== originalProjectId) {
    throw new WorkflowValidationError(
      `projectId is immutable for a workflow instance (was "${originalProjectId}", got "${context.projectId}")`,
    );
  }
}

export function mergeContextVariables(
  context: WorkflowContext,
  patch: Record<string, unknown>,
): WorkflowContext {
  assertNoSecrets(patch);
  return {
    ...context,
    variables: {
      ...context.variables,
      ...structuredClone(patch),
    },
  };
}

export function isSerializable(value: unknown): boolean {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function assertNoSecrets(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new WorkflowValidationError(
        `Workflow context must not contain secrets (forbidden key: "${key}")`,
      );
    }
  }
}
