/**
 * Controlled write execution types — fail closed, no secrets.
 */

export type ExecutionActorType = "human" | "agent" | "system" | "workflow";

export interface ExecutionActor {
  type: ExecutionActorType;
  id: string;
}

export type ExecutionActionId =
  | "github.create_branch"
  | "github.create_pull_request"
  | "jira.update_issue"
  | "github.merge_pull_request"
  | "confluence.update_page"
  | "deploy.staging"
  | "deploy.production"
  | "database.migration";

export interface ExecutionResource {
  /** Resolved server-side; never trust caller-supplied repo/space as authority. */
  repository?: string;
  issueKey?: string;
  branchName?: string;
  pullRequestNumber?: number;
  spaceKey?: string;
}

export interface ExecutionRequest {
  requestId: string;
  projectId: string;
  actor: ExecutionActor;
  agentId?: string;
  workflowId?: string;
  workflowInstanceId?: string;
  stepId?: string;
  action: ExecutionActionId;
  resource: ExecutionResource;
  parameters: Record<string, unknown>;
  reason: string;
  /** Must come from ApprovalStore — never trust caller boolean flags. */
  approvalRequestId?: string;
  dryRun?: boolean;
}

export interface ExecutionDecision {
  allowed: boolean;
  reason: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  requiresApproval: boolean;
  governanceDecision?: "ALLOW" | "HUMAN_APPROVAL" | "DENY";
}

export interface ExecutionResult {
  success: boolean;
  action: ExecutionActionId;
  resource: ExecutionResource;
  externalId?: string;
  result?: unknown;
  error?: string;
  auditId: string;
  dryRun?: boolean;
  duplicate?: boolean;
}

export type ExecutionAuditEvent =
  | "EXECUTION_REQUESTED"
  | "EXECUTION_ALLOWED"
  | "EXECUTION_DENIED"
  | "EXECUTION_APPROVAL_REQUIRED"
  | "EXECUTION_STARTED"
  | "EXECUTION_COMPLETED"
  | "EXECUTION_FAILED"
  | "EXECUTION_DUPLICATE";

export interface WriteActionDefinition {
  action: ExecutionActionId;
  enabled: boolean;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  /** Soft hint; GovernanceService is authoritative. */
  requiresApproval: boolean;
  allowedActors: ExecutionActorType[];
  /** Agent ids allowed to request this action (empty = no agents). */
  allowedAgentIds: string[];
  projectScoped: boolean;
  /** Governance ActionType string. */
  governanceAction: string;
  mcpToolName?: string;
}

export interface ApprovedExecutionRecord {
  id: string;
  projectId: string;
  action: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  workflowInstanceId?: string;
  stepId?: string;
}

/**
 * Lookup for persisted approvals. Never trust approval=true from the AI.
 */
export interface ExecutionApprovalLookup {
  get(approvalRequestId: string): ApprovedExecutionRecord | undefined;
}
