import type {
  ApprovalRequestMetadata,
  ApprovalRulesPolicy,
  GovernanceConfig,
  GovernanceDecision,
} from "./policy.types.js";

export interface ApprovalServiceOptions {
  approvalRules: ApprovalRulesPolicy;
  governance: GovernanceConfig;
}

/**
 * Determines approval requirements. Does not execute actions or notify humans.
 */
export class ApprovalService {
  private readonly approvalRules: ApprovalRulesPolicy;
  private readonly governance: GovernanceConfig;

  constructor(options: ApprovalServiceOptions) {
    this.approvalRules = options.approvalRules;
    this.governance = options.governance;
  }

  isApprovalEnabled(): boolean {
    return this.governance.approval.enabled;
  }

  requiresApproval(decision: GovernanceDecision): boolean {
    if (!this.governance.approval.enabled) {
      return false;
    }
    if (decision.decision === "HUMAN_APPROVAL") {
      return true;
    }
    if (decision.decision === "DENY" || decision.decision === "ALLOW") {
      return decision.requiresApproval;
    }
    return false;
  }

  buildApprovalRequest(decision: GovernanceDecision): ApprovalRequestMetadata | null {
    if (!this.requiresApproval(decision)) {
      return null;
    }

    const rule = this.approvalRules.rules.find((r) => r.action === decision.action);
    const minimumApprovers = rule?.approval.minimumApprovers ?? 1;
    const conditions = rule?.require;

    const metadata: ApprovalRequestMetadata = {
      required: true,
      minimumApprovers,
      reason: decision.reason,
      action: decision.action,
      projectId: decision.projectId,
    };
    if (conditions !== undefined && conditions.length > 0) {
      metadata.conditions = [...conditions];
    }
    return metadata;
  }

  validateApprovalRequirements(action: string): {
    valid: boolean;
    reason: string;
    minimumApprovers?: number;
    conditions?: string[];
  } {
    const rule = this.approvalRules.rules.find((r) => r.action === action);
    if (!rule) {
      return {
        valid: true,
        reason: "No explicit approval rule; decision matrix still applies",
      };
    }
    if (!rule.approval.required) {
      return {
        valid: true,
        reason: "Approval rule present but required=false",
        minimumApprovers: rule.approval.minimumApprovers,
        ...(rule.require ? { conditions: [...rule.require] } : {}),
      };
    }
    if (rule.approval.minimumApprovers < 1) {
      return {
        valid: false,
        reason: "minimumApprovers must be >= 1",
      };
    }
    return {
      valid: true,
      reason: "Approval requirements are valid",
      minimumApprovers: rule.approval.minimumApprovers,
      ...(rule.require ? { conditions: [...rule.require] } : {}),
    };
  }
}
