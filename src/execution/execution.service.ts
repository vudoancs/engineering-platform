import { randomUUID } from "node:crypto";
import type { AuditService } from "../governance/audit.service.js";
import { InMemoryAuditService } from "../governance/audit.service.js";
import {
  ApprovalRequiredError,
  ExecutionError,
  ExternalServiceError,
  InvalidParametersError,
} from "./execution-errors.js";
import {
  cloneResource,
  summarizeRequest,
  validateBranchName,
  validateIssueKey,
  validateJiraUpdateFields,
  validatePrBody,
  validatePrTitle,
} from "./execution-context.js";
import {
  decisionToError,
  ExecutionGuard,
  type ExecutionGuardOptions,
} from "./execution.guard.js";
import {
  InMemoryIdempotencyService,
  type IdempotencyService,
} from "./idempotency.service.js";
import type {
  ExecutionAuditEvent,
  ExecutionRequest,
  ExecutionResult,
} from "./execution.types.js";

export interface GitHubWritePort {
  createBranch(input: {
    projectId: string;
    repository: string;
    branchName: string;
    baseBranch: string;
  }): Promise<{ ref: string; sha: string }>;
  createPullRequest(input: {
    projectId: string;
    repository: string;
    headBranch: string;
    baseBranch: string;
    title: string;
    body: string;
  }): Promise<{ number: number; htmlUrl: string; title: string }>;
}

export interface JiraWritePort {
  updateIssue(input: {
    projectId: string;
    issueKey: string;
    fields: Record<string, unknown>;
  }): Promise<{ issueKey: string; updated: string[] }>;
}

export interface ExecutionServiceOptions extends ExecutionGuardOptions {
  githubWrite?: GitHubWritePort | null;
  jiraWrite?: JiraWritePort | null;
  idempotency?: IdempotencyService;
  audit?: AuditService;
}

/**
 * Orchestrates guarded write execution. Side effects only after authorize().
 */
export class ExecutionService {
  private readonly guard: ExecutionGuard;
  private readonly githubWrite: GitHubWritePort | null;
  private readonly jiraWrite: JiraWritePort | null;
  private readonly idempotency: IdempotencyService;
  private readonly audit: AuditService;

  constructor(options: ExecutionServiceOptions) {
    this.guard = new ExecutionGuard(options);
    this.githubWrite = options.githubWrite ?? null;
    this.jiraWrite = options.jiraWrite ?? null;
    this.idempotency = options.idempotency ?? new InMemoryIdempotencyService();
    this.audit = options.audit ?? new InMemoryAuditService();
  }

  getGuard(): ExecutionGuard {
    return this.guard;
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const auditId = randomUUID();
    this.record("EXECUTION_REQUESTED", request, auditId, "ALLOW", request.reason);

    const idemKey = this.idempotency.buildKey({
      projectId: request.projectId,
      action: request.action,
      ...(request.requestId ? { requestId: request.requestId } : {}),
      ...(request.workflowInstanceId
        ? { workflowInstanceId: request.workflowInstanceId }
        : {}),
      ...(request.stepId ? { stepId: request.stepId } : {}),
    });

    const existing = this.idempotency.get(idemKey);
    if (existing) {
      this.record(
        "EXECUTION_DUPLICATE",
        request,
        auditId,
        "ALLOW",
        "Returning previous execution result",
      );
      return { ...existing, duplicate: true, auditId };
    }

    let decision;
    try {
      decision = this.guard.authorize(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authorization failed";
      this.record("EXECUTION_DENIED", request, auditId, "DENY", message);
      throw error;
    }

    if (!decision.allowed) {
      if (decision.requiresApproval) {
        this.record(
          "EXECUTION_APPROVAL_REQUIRED",
          request,
          auditId,
          "HUMAN_APPROVAL",
          decision.reason,
        );
        throw new ApprovalRequiredError(decision.reason, {
          action: request.action,
          projectId: request.projectId,
        });
      }
      this.record("EXECUTION_DENIED", request, auditId, "DENY", decision.reason);
      throw decisionToError(decision);
    }

    this.record("EXECUTION_ALLOWED", request, auditId, "ALLOW", decision.reason);

    if (request.dryRun === true) {
      const dryResult: ExecutionResult = {
        success: true,
        action: request.action,
        resource: cloneResource(request.resource),
        result: {
          dryRun: true,
          action: request.action,
          resource: request.resource,
          parameters: request.parameters,
        },
        auditId,
        dryRun: true,
      };
      this.idempotency.set(idemKey, dryResult);
      this.record("EXECUTION_COMPLETED", request, auditId, "ALLOW", "Dry-run only");
      return dryResult;
    }

    this.record("EXECUTION_STARTED", request, auditId, "ALLOW", "Starting side effect");

    try {
      const result = await this.perform(request, auditId);
      this.idempotency.set(idemKey, result);
      this.record("EXECUTION_COMPLETED", request, auditId, "ALLOW", "Execution completed");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Execution failed";
      this.record("EXECUTION_FAILED", request, auditId, "DENY", message);
      if (error instanceof ExecutionError) throw error;
      throw new ExternalServiceError(message);
    }
  }

  private async perform(
    request: ExecutionRequest,
    auditId: string,
  ): Promise<ExecutionResult> {
    switch (request.action) {
      case "github.create_branch":
        return this.createBranch(request, auditId);
      case "github.create_pull_request":
        return this.createPullRequest(request, auditId);
      case "jira.update_issue":
        return this.updateJira(request, auditId);
      default:
        throw new ExecutionError(`Action "${request.action}" is not executable`, {
          code: "ACTION_NOT_ALLOWED",
        });
    }
  }

  private async createBranch(
    request: ExecutionRequest,
    auditId: string,
  ): Promise<ExecutionResult> {
    if (!this.githubWrite) {
      throw new ExternalServiceError("GitHub write port is not configured");
    }
    const branchName = validateBranchName(String(request.parameters.branchName ?? ""));
    const baseBranch = String(request.parameters.baseBranch ?? "main").trim();
    if (!baseBranch) {
      throw new InvalidParametersError("baseBranch is required");
    }

    const repository =
      request.resource.repository ??
      this.guard.resolveRepository(request.projectId);

    const created = await this.githubWrite.createBranch({
      projectId: request.projectId,
      repository,
      branchName,
      baseBranch,
    });

    return {
      success: true,
      action: request.action,
      resource: { repository, branchName },
      externalId: created.ref,
      result: created,
      auditId,
    };
  }

  private async createPullRequest(
    request: ExecutionRequest,
    auditId: string,
  ): Promise<ExecutionResult> {
    if (!this.githubWrite) {
      throw new ExternalServiceError("GitHub write port is not configured");
    }
    const headBranch = validateBranchName(String(request.parameters.headBranch ?? ""));
    const baseBranch = String(request.parameters.baseBranch ?? "").trim();
    if (!baseBranch) {
      throw new InvalidParametersError("baseBranch is required");
    }
    const title = validatePrTitle(String(request.parameters.title ?? ""));
    const body = validatePrBody(String(request.parameters.body ?? ""));

    const repository =
      request.resource.repository ??
      this.guard.resolveRepository(request.projectId);

    const pr = await this.githubWrite.createPullRequest({
      projectId: request.projectId,
      repository,
      headBranch,
      baseBranch,
      title,
      body,
    });

    return {
      success: true,
      action: request.action,
      resource: {
        repository,
        branchName: headBranch,
        pullRequestNumber: pr.number,
      },
      externalId: String(pr.number),
      result: { ...pr, event: "PR_CREATED" },
      auditId,
    };
  }

  private async updateJira(
    request: ExecutionRequest,
    auditId: string,
  ): Promise<ExecutionResult> {
    if (!this.jiraWrite) {
      throw new ExternalServiceError("Jira write port is not configured");
    }
    const issueKey = validateIssueKey(
      String(request.resource.issueKey ?? request.parameters.issueKey ?? ""),
    );
    const rawFields = (request.parameters.fields ?? {}) as Record<string, unknown>;
    const fields = validateJiraUpdateFields(rawFields);

    const updated = await this.jiraWrite.updateIssue({
      projectId: request.projectId,
      issueKey,
      fields,
    });

    return {
      success: true,
      action: request.action,
      resource: { issueKey },
      externalId: issueKey,
      result: updated,
      auditId,
    };
  }

  private record(
    event: ExecutionAuditEvent,
    request: ExecutionRequest,
    auditId: string,
    decision: "ALLOW" | "HUMAN_APPROVAL" | "DENY",
    reason: string,
  ): void {
    this.audit.record({
      timestamp: new Date().toISOString(),
      requestId: `${request.requestId}:${auditId}:${event}`,
      projectId: request.projectId,
      actor: `${request.actor.type}:${request.actor.id}`,
      action: event,
      decision,
      riskLevel: "MEDIUM",
      reason: `${reason} | ${JSON.stringify(summarizeRequest(request))}`,
    });
  }
}
