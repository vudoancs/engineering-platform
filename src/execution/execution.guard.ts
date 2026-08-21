import type { ProjectConfigService } from "../config/project-config/project-config.service.js";
import type { GovernanceService } from "../governance/governance.service.js";
import {
  ActionNotAllowedError,
  ApprovalRequiredError,
  GovernanceDeniedError,
  InvalidParametersError,
  ProjectAccessDeniedError,
  ResourceOutOfScopeError,
  UnauthorizedAgentError,
} from "./execution-errors.js";
import { assertNoSecretsInParameters } from "./execution-context.js";
import { getWriteAction, isKnownWriteAction } from "./execution-policy.js";
import type {
  ExecutionApprovalLookup,
  ExecutionDecision,
  ExecutionRequest,
} from "./execution.types.js";

export type ProjectExistenceChecker = (projectId: string) => boolean;

export interface ExecutionGuardOptions {
  governance: GovernanceService;
  projectConfig: ProjectConfigService;
  isProjectKnown?: ProjectExistenceChecker;
  approvalLookup?: ExecutionApprovalLookup;
}

/**
 * Fail-closed authorization for controlled writes.
 * Every write path must call authorize() before side effects.
 */
export class ExecutionGuard {
  private readonly governance: GovernanceService;
  private readonly projectConfig: ProjectConfigService;
  private readonly isProjectKnown?: ProjectExistenceChecker;
  private readonly approvalLookup?: ExecutionApprovalLookup;

  constructor(options: ExecutionGuardOptions) {
    this.governance = options.governance;
    this.projectConfig = options.projectConfig;
    if (options.isProjectKnown) this.isProjectKnown = options.isProjectKnown;
    if (options.approvalLookup) this.approvalLookup = options.approvalLookup;
  }

  authorize(request: ExecutionRequest): ExecutionDecision {
    assertNoSecretsInParameters(request.parameters);

    if (!request.projectId?.trim()) {
      throw new InvalidParametersError("projectId is required");
    }

    if (this.isProjectKnown && !this.isProjectKnown(request.projectId)) {
      throw new ProjectAccessDeniedError(
        `Unknown or inaccessible project "${request.projectId}"`,
        { projectId: request.projectId },
      );
    }

    try {
      const project = this.projectConfig.getProject(request.projectId);
      if (!project.settings.enabled) {
        throw new ProjectAccessDeniedError(
          `Project "${request.projectId}" is disabled`,
        );
      }
    } catch (error) {
      if (error instanceof ProjectAccessDeniedError) throw error;
      throw new ProjectAccessDeniedError(
        `Project "${request.projectId}" is not accessible`,
        { projectId: request.projectId },
      );
    }

    if (!isKnownWriteAction(request.action)) {
      throw new ActionNotAllowedError(`Unknown action "${request.action}"`, {
        action: request.action,
      });
    }

    const actionDef = getWriteAction(request.action)!;
    if (!actionDef.enabled) {
      return {
        allowed: false,
        reason: `Action "${request.action}" is disabled by engineering policy`,
        riskLevel: actionDef.riskLevel,
        requiresApproval: actionDef.requiresApproval,
        governanceDecision: "DENY",
      };
    }

    if (!actionDef.allowedActors.includes(request.actor.type)) {
      throw new ActionNotAllowedError(
        `Actor type "${request.actor.type}" is not allowed for ${request.action}`,
      );
    }

    if (request.actor.type === "agent" || request.agentId) {
      const agentId = request.agentId ?? request.actor.id;
      if (!actionDef.allowedAgentIds.includes(agentId)) {
        throw new UnauthorizedAgentError(
          `Agent "${agentId}" is not authorized for ${request.action}`,
          { agentId, action: request.action },
        );
      }
    }

    this.assertResourceInProject(request);

    const gov = this.governance.evaluate({
      projectId: request.projectId,
      action: actionDef.governanceAction,
      requestId: request.requestId,
      ...(request.actor
        ? { actor: `${request.actor.type}:${request.actor.id}` }
        : {}),
      context: {
        ...(request.resource.repository
          ? { repository: request.resource.repository }
          : {}),
        ...(request.resource.branchName
          ? { branch: request.resource.branchName }
          : {}),
        ...(request.resource.issueKey
          ? { issueKey: request.resource.issueKey }
          : {}),
        ...(request.resource.pullRequestNumber !== undefined
          ? { pullRequestNumber: request.resource.pullRequestNumber }
          : {}),
      },
    });

    if (gov.decision === "DENY") {
      throw new GovernanceDeniedError(
        `Governance DENY for ${actionDef.governanceAction}: ${gov.reason}`,
        { action: request.action, governanceAction: actionDef.governanceAction },
      );
    }

    if (gov.decision === "HUMAN_APPROVAL" || actionDef.requiresApproval) {
      const approved = this.hasValidApproval(request, actionDef.governanceAction);
      if (!approved) {
        return {
          allowed: false,
          reason: `Approval required for ${request.action}`,
          riskLevel: gov.riskLevel,
          requiresApproval: true,
          governanceDecision: "HUMAN_APPROVAL",
        };
      }
    }

    return {
      allowed: true,
      reason: gov.reason,
      riskLevel: gov.riskLevel,
      requiresApproval: false,
      governanceDecision: "ALLOW",
    };
  }

  private hasValidApproval(
    request: ExecutionRequest,
    governanceAction: string,
  ): boolean {
    if (!request.approvalRequestId) {
      return false;
    }
    if (!this.approvalLookup) {
      return false;
    }
    const record = this.approvalLookup.get(request.approvalRequestId);
    if (!record) {
      return false;
    }
    if (record.status !== "APPROVED") {
      return false;
    }
    if (record.projectId !== request.projectId) {
      return false;
    }
    // Action on approval may be governance action name or execution action id
    if (
      record.action &&
      record.action !== governanceAction &&
      record.action !== request.action
    ) {
      return false;
    }
    return true;
  }

  private assertResourceInProject(request: ExecutionRequest): void {
    const { action, projectId, resource, parameters } = request;

    if (action.startsWith("github.")) {
      // Never trust caller repository as authority — ignore parameters.repository
      if (typeof parameters.repository === "string") {
        // Explicit reject of using caller repo as authority when it differs from resolved
        const github = this.projectConfig.getGithubConfig(projectId);
        const allowed = github.repositories.map(
          (r) => `${github.organization}/${r}`,
        );
        const full = parameters.repository.includes("/")
          ? parameters.repository
          : `${github.organization}/${parameters.repository}`;
        if (!allowed.includes(full) && !github.repositories.includes(parameters.repository)) {
          throw new ResourceOutOfScopeError(
            `Repository "${parameters.repository}" is outside project "${projectId}"`,
            { projectId, repository: parameters.repository },
          );
        }
      }
      if (resource.repository) {
        const github = this.projectConfig.getGithubConfig(projectId);
        const allowed = new Set([
          ...github.repositories,
          ...github.repositories.map((r) => `${github.organization}/${r}`),
        ]);
        if (!allowed.has(resource.repository)) {
          throw new ResourceOutOfScopeError(
            `Repository "${resource.repository}" is outside project "${projectId}"`,
          );
        }
      }
    }

    if (action.startsWith("jira.") && resource.issueKey) {
      const jira = this.projectConfig.getJiraConfig(projectId);
      const prefix = `${jira.projectKey}-`;
      if (!resource.issueKey.toUpperCase().startsWith(prefix)) {
        throw new ResourceOutOfScopeError(
          `Issue "${resource.issueKey}" is outside Jira project ${jira.projectKey}`,
          { issueKey: resource.issueKey, projectKey: jira.projectKey },
        );
      }
    }
  }

  /**
   * Resolve canonical repository for a project (first configured), optionally
   * validating a suggested short name against allowlist.
   */
  resolveRepository(
    projectId: string,
    suggested?: string,
  ): string {
    const github = this.projectConfig.getGithubConfig(projectId);
    if (github.repositories.length === 0) {
      throw new ResourceOutOfScopeError(
        `Project "${projectId}" has no configured GitHub repositories`,
      );
    }
    if (suggested) {
      const short = suggested.includes("/")
        ? suggested.split("/").pop()!
        : suggested;
      if (!github.repositories.includes(short)) {
        throw new ResourceOutOfScopeError(
          `Repository "${suggested}" is outside project "${projectId}"`,
        );
      }
      return `${github.organization}/${short}`;
    }
    return `${github.organization}/${github.repositories[0]}`;
  }
}

export function decisionToError(decision: ExecutionDecision): Error {
  if (decision.requiresApproval) {
    return new ApprovalRequiredError(decision.reason);
  }
  return new ActionNotAllowedError(decision.reason);
}
