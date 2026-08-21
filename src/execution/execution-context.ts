import { InvalidParametersError } from "./execution-errors.js";
import type { ExecutionRequest, ExecutionResource } from "./execution.types.js";

const SECRET_KEY = /(password|secret|token|api[_-]?key|authorization|credential|accessToken)/i;
const BRANCH_NAME_RE = /^(?!.*\.\.)(?!\/)(?!.*\/\/)(?!.*@\{)[A-Za-z0-9._\-/]+(?<!\.lock)(?<!\/)$/;
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;

/**
 * Build / sanitize execution context. Rejects secrets and forbidden caller fields.
 */
export function assertNoSecretsInParameters(
  parameters: Record<string, unknown>,
): void {
  for (const key of Object.keys(parameters)) {
    if (SECRET_KEY.test(key)) {
      throw new InvalidParametersError(
        `Parameters must not contain secrets (forbidden key: "${key}")`,
      );
    }
  }
  if (
    "repositoryUrl" in parameters ||
    "accessToken" in parameters ||
    "apiKey" in parameters
  ) {
    throw new InvalidParametersError(
      "Parameters must not include credentials or repository URLs",
    );
  }
}

export function validateBranchName(branchName: string): string {
  const trimmed = branchName.trim();
  if (!trimmed || trimmed.length > 255 || !BRANCH_NAME_RE.test(trimmed)) {
    throw new InvalidParametersError(`Invalid branch name: "${branchName}"`);
  }
  if (trimmed === "main" || trimmed === "master") {
    throw new InvalidParametersError(
      `Refusing to create protected branch name "${trimmed}"`,
    );
  }
  return trimmed;
}

export function validateIssueKey(issueKey: string): string {
  const trimmed = issueKey.trim().toUpperCase();
  if (!ISSUE_KEY_RE.test(trimmed)) {
    throw new InvalidParametersError(`Invalid issue key: "${issueKey}"`);
  }
  return trimmed;
}

export function validatePrTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) {
    throw new InvalidParametersError("PR title must not be empty");
  }
  if (trimmed.length > 256) {
    throw new InvalidParametersError("PR title exceeds 256 characters");
  }
  return trimmed;
}

export function validatePrBody(body: string): string {
  if (body.length > 65_536) {
    throw new InvalidParametersError("PR body exceeds maximum size");
  }
  return body;
}

const ALLOWED_JIRA_FIELDS = new Set(["status", "comment", "labels"]);

export function validateJiraUpdateFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const keys = Object.keys(fields);
  if (keys.length === 0) {
    throw new InvalidParametersError("jira.update_issue requires at least one field");
  }
  for (const key of keys) {
    if (!ALLOWED_JIRA_FIELDS.has(key)) {
      throw new InvalidParametersError(
        `Unsupported Jira field "${key}". Allowed: status, comment, labels`,
      );
    }
  }
  return fields;
}

export function cloneResource(resource: ExecutionResource): ExecutionResource {
  return structuredClone(resource);
}

export function summarizeRequest(request: ExecutionRequest): Record<string, unknown> {
  return {
    requestId: request.requestId,
    projectId: request.projectId,
    action: request.action,
    actor: request.actor,
    ...(request.agentId !== undefined ? { agentId: request.agentId } : {}),
    ...(request.workflowInstanceId !== undefined
      ? { workflowInstanceId: request.workflowInstanceId }
      : {}),
    resource: request.resource,
    dryRun: request.dryRun === true,
  };
}
