import { randomUUID } from "node:crypto";
import { ApprovalService } from "./approval.service.js";
import type { AuditService } from "./audit.service.js";
import { InMemoryAuditService } from "./audit.service.js";
import { GovernanceConfigurationError } from "./governance.errors.js";
import { PolicyLoader } from "./policy-loader.js";
import type {
  DecisionType,
  GovernanceDecision,
  GovernanceEvaluateRequest,
  LoadedPolicies,
  RiskLevel,
} from "./policy.types.js";

export type ProjectExistenceChecker = (projectId: string) => boolean;

export interface GovernanceServiceOptions {
  policies: LoadedPolicies;
  audit?: AuditService;
  /**
   * Optional project existence check. When provided, unknown projects DENY.
   * When omitted, only empty projectId is rejected.
   */
  isProjectKnown?: ProjectExistenceChecker;
}

/**
 * Deterministic policy enforcement. Does not execute tools or call LLMs.
 */
export class GovernanceService {
  private readonly policies: LoadedPolicies;
  private readonly approvalService: ApprovalService;
  private readonly audit: AuditService;
  private readonly isProjectKnown?: ProjectExistenceChecker;
  private readonly denyAllReason?: string;

  private constructor(
    options: GovernanceServiceOptions & { denyAllReason?: string },
  ) {
    this.policies = options.policies;
    this.approvalService = new ApprovalService({
      approvalRules: options.policies.approvalRules,
      governance: options.policies.governance,
    });
    this.audit = options.audit ?? new InMemoryAuditService();
    if (options.isProjectKnown) {
      this.isProjectKnown = options.isProjectKnown;
    }
    if (options.denyAllReason !== undefined) {
      this.denyAllReason = options.denyAllReason;
    }
  }

  static fromPolicies(options: GovernanceServiceOptions): GovernanceService {
    return new GovernanceService(options);
  }

  static loadFromDirectory(options: {
    policiesDir: string;
    audit?: AuditService;
    isProjectKnown?: ProjectExistenceChecker;
  }): GovernanceService {
    const loader = new PolicyLoader({ policiesDir: options.policiesDir });
    try {
      const policies = loader.load();
      return GovernanceService.fromPolicies({
        policies,
        ...(options.audit ? { audit: options.audit } : {}),
        ...(options.isProjectKnown ? { isProjectKnown: options.isProjectKnown } : {}),
      });
    } catch (error) {
      // Fail closed: never allow when configuration is invalid.
      if (
        error instanceof GovernanceConfigurationError ||
        (error instanceof Error && error.message.length > 0)
      ) {
        return GovernanceService.createDenyAll({
          reason:
            error instanceof Error
              ? `Policy configuration invalid (fail closed): ${error.message}`
              : "Policy configuration invalid (fail closed)",
          ...(options.audit ? { audit: options.audit } : {}),
          ...(options.isProjectKnown
            ? { isProjectKnown: options.isProjectKnown }
            : {}),
          cause: error,
        });
      }
      throw error;
    }
  }

  /**
   * Always-DENY instance used when policies cannot be loaded safely.
   */
  static createDenyAll(options: {
    reason: string;
    audit?: AuditService;
    isProjectKnown?: ProjectExistenceChecker;
    cause?: unknown;
  }): GovernanceService {
    const emptyPolicies: LoadedPolicies = {
      policiesDir: "(unavailable)",
      permissions: { actions: {} },
      approvalRules: { rules: [] },
      governance: {
        version: 1,
        defaults: {
          unknownAction: "DENY",
          missingPolicy: "DENY",
          failClosed: true,
        },
        security: { readOnlyByDefault: true },
        approval: { enabled: true },
        projects: { default: { allowWrite: false } },
      },
    };

    const service = new GovernanceService({
      policies: emptyPolicies,
      denyAllReason: options.reason,
      ...(options.audit ? { audit: options.audit } : {}),
      ...(options.isProjectKnown ? { isProjectKnown: options.isProjectKnown } : {}),
    });

    // Preserve cause for diagnostics without becoming permissive.
    if (options.cause !== undefined) {
      void options.cause;
    }
    return service;
  }

  getApprovalService(): ApprovalService {
    return this.approvalService;
  }

  getAuditService(): AuditService {
    return this.audit;
  }

  getPolicies(): LoadedPolicies {
    return this.policies;
  }

  isFailClosed(): boolean {
    return this.policies.governance.defaults.failClosed || Boolean(this.denyAllReason);
  }

  evaluate(request: GovernanceEvaluateRequest): GovernanceDecision {
    const projectId = request.projectId?.trim() ?? "";
    const action = request.action?.trim() ?? "";
    const requestId = request.requestId ?? randomUUID();
    const actor = request.actor?.trim() || "agent";

    const decide = (
      decision: DecisionType,
      riskLevel: RiskLevel,
      reason: string,
      requiresApproval?: boolean,
    ): GovernanceDecision => {
      const result: GovernanceDecision = {
        decision,
        action: action || "(missing)",
        projectId: projectId || "(missing)",
        reason,
        riskLevel,
        requiresApproval:
          requiresApproval ??
          (decision === "HUMAN_APPROVAL" && this.policies.governance.approval.enabled),
      };
      this.audit.record({
        timestamp: new Date().toISOString(),
        requestId,
        projectId: result.projectId,
        actor,
        action: result.action,
        decision: result.decision,
        riskLevel: result.riskLevel,
        reason: result.reason,
      });
      return result;
    };

    if (this.denyAllReason) {
      return decide("DENY", "CRITICAL", this.denyAllReason, false);
    }

    if (!projectId) {
      return decide("DENY", "CRITICAL", "projectId is required (fail closed)", false);
    }

    if (!action) {
      return decide("DENY", "CRITICAL", "action is required (fail closed)", false);
    }

    if (this.isProjectKnown && !this.isProjectKnown(projectId)) {
      return decide(
        "DENY",
        "CRITICAL",
        `Unknown project "${projectId}" (fail closed)`,
        false,
      );
    }

    // Future hook: project-scoped allowWrite (abstraction only — no complex overrides yet).
    void this.resolveProjectSettings(projectId);

    const actionPolicy = this.policies.permissions.actions[action];
    if (!actionPolicy) {
      const fallback = this.policies.governance.defaults.unknownAction;
      return decide(
        fallback,
        "CRITICAL",
        `Unknown action "${action}" — default is ${fallback} (fail closed)`,
        fallback === "HUMAN_APPROVAL",
      );
    }

    const requiresApproval =
      actionPolicy.decision === "HUMAN_APPROVAL" &&
      this.policies.governance.approval.enabled;

    const reason =
      actionPolicy.reason ??
      defaultReason(action, actionPolicy.decision, actionPolicy.riskLevel);

    return decide(actionPolicy.decision, actionPolicy.riskLevel, reason, requiresApproval);
  }

  /**
   * Reserved for future per-project policy matrices.
   * Today returns default or named project allowWrite flag only.
   */
  resolveProjectSettings(projectId: string): { allowWrite: boolean } {
    const specific = this.policies.governance.projects[projectId];
    if (specific) {
      return { allowWrite: specific.allowWrite };
    }
    const fallback = this.policies.governance.projects.default;
    return { allowWrite: fallback?.allowWrite ?? false };
  }
}

function defaultReason(action: string, decision: DecisionType, riskLevel: RiskLevel): string {
  switch (decision) {
    case "ALLOW":
      return `Action ${action} is allowed by policy (risk=${riskLevel})`;
    case "HUMAN_APPROVAL":
      return `Action ${action} requires human approval (risk=${riskLevel})`;
    case "DENY":
      return `Action ${action} is denied by policy (risk=${riskLevel})`;
  }
}
