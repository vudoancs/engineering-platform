/**
 * Governance policy types — deterministic, no LLM.
 */

export const ACTION_TYPES = [
  "READ_JIRA",
  "READ_GITHUB",
  "READ_CONFLUENCE",
  "CREATE_BRANCH",
  "CREATE_PULL_REQUEST",
  "UPDATE_JIRA",
  "UPDATE_CONFLUENCE",
  "MERGE_PULL_REQUEST",
  "DEPLOY_STAGING",
  "DEPLOY_PRODUCTION",
  "DATABASE_MIGRATION",
  "DELETE_RESOURCE",
  "EXECUTE_SHELL",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export type DecisionType = "ALLOW" | "HUMAN_APPROVAL" | "DENY";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ActionPolicy {
  decision: DecisionType;
  riskLevel: RiskLevel;
  reason?: string | undefined;
}

export interface PermissionsPolicy {
  actions: Record<string, ActionPolicy>;
}

export interface ApprovalRequirement {
  required: boolean;
  minimumApprovers: number;
}

export interface ApprovalRule {
  action: string;
  require?: string[] | undefined;
  approval: ApprovalRequirement;
}

export interface ApprovalRulesPolicy {
  rules: ApprovalRule[];
}

export interface ProjectGovernanceSettings {
  allowWrite: boolean;
}

export interface GovernanceConfig {
  version: number;
  defaults: {
    unknownAction: DecisionType;
    missingPolicy: DecisionType;
    failClosed: boolean;
  };
  security: {
    readOnlyByDefault: boolean;
  };
  approval: {
    enabled: boolean;
  };
  /** Future per-project overrides; only `allowWrite` is reserved today. */
  projects: Record<string, ProjectGovernanceSettings>;
}

export interface LoadedPolicies {
  permissions: PermissionsPolicy;
  approvalRules: ApprovalRulesPolicy;
  governance: GovernanceConfig;
  policiesDir: string;
}

export interface GovernanceEvaluateContext {
  repository?: string;
  branch?: string;
  pullRequestNumber?: number;
  environment?: string;
  issueKey?: string;
  riskSignals?: string[];
}

export interface GovernanceEvaluateRequest {
  projectId: string;
  action: string;
  context?: GovernanceEvaluateContext;
  requestId?: string;
  actor?: string;
}

export interface GovernanceDecision {
  decision: DecisionType;
  action: string;
  projectId: string;
  reason: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
}

export interface ApprovalRequestMetadata {
  required: boolean;
  minimumApprovers: number;
  reason: string;
  action: string;
  projectId: string;
  conditions?: string[];
}

export interface GovernanceAuditEntry {
  timestamp: string;
  requestId: string;
  projectId: string;
  actor: string;
  action: string;
  decision: DecisionType;
  riskLevel: RiskLevel;
  reason: string;
}
