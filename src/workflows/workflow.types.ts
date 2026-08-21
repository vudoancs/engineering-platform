/**
 * Workflow orchestration types — deterministic state machine, no LLM runtime.
 */

export const WORKFLOW_STATUSES = [
  "PENDING",
  "RUNNING",
  "WAITING_APPROVAL",
  "FAILED",
  "COMPLETED",
  "CANCELLED",
] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const STEP_TYPES = ["AGENT", "ACTION", "APPROVAL", "CONDITION"] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const STEP_RUN_STATUSES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "WAITING_APPROVAL",
  "SKIPPED",
] as const;

export type StepRunStatus = (typeof STEP_RUN_STATUSES)[number];

export const PREDEFINED_CONDITIONS = [
  "CI_PASSED",
  "PR_APPROVED",
  "RISK_LTE_MEDIUM",
] as const;

export type PredefinedCondition = (typeof PREDEFINED_CONDITIONS)[number];

export const WORKFLOW_AUDIT_EVENTS = [
  "WORKFLOW_CREATED",
  "WORKFLOW_STARTED",
  "STEP_STARTED",
  "STEP_COMPLETED",
  "STEP_FAILED",
  "APPROVAL_REQUESTED",
  "APPROVAL_APPROVED",
  "APPROVAL_REJECTED",
  "WORKFLOW_COMPLETED",
  "WORKFLOW_FAILED",
  "WORKFLOW_CANCELLED",
] as const;

export type WorkflowAuditEvent = (typeof WORKFLOW_AUDIT_EVENTS)[number];

export const DEFAULT_STEP_TIMEOUT_MS = 5 * 60 * 1000;

export interface WorkflowTrigger {
  type: "manual";
}

export interface StepApprovalConfig {
  required: boolean;
  minimumApprovers: number;
  reason?: string;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export interface StepRetryConfig {
  maxAttempts: number;
}

export interface WorkflowStep {
  id: string;
  type: StepType;
  agent?: string;
  action?: string;
  condition?: PredefinedCondition;
  dependsOn?: string[];
  approval?: StepApprovalConfig;
  onSuccess?: string;
  onFailure?: string;
  enabled?: boolean;
  retry?: StepRetryConfig;
  timeoutMs?: number;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: number;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  sourceDir: string;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  version: number;
  description: string;
  stepCount: number;
}

export interface WorkflowContext {
  projectId: string;
  issueKey?: string;
  repository?: string;
  branch?: string;
  pullRequestNumber?: number;
  actor?: string;
  /** Serializable bag — never store secrets. */
  variables: Record<string, unknown>;
}

export interface StepExecutionRecord {
  stepId: string;
  status: StepRunStatus;
  attempt: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  idempotencyKey: string;
  output?: unknown;
}

export interface WorkflowInstance {
  id: string;
  workflowId: string;
  projectId: string;
  status: WorkflowStatus;
  currentStepId: string | null;
  context: WorkflowContext;
  stepRecords: Record<string, StepExecutionRecord>;
  pendingApprovalRequestId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentExecutionInput {
  agentId: string;
  projectId: string;
  workflowInstanceId: string;
  stepId: string;
  context: WorkflowContext;
  instructions: string;
  allowedTools: string[];
}

export interface AgentExecutionResult {
  status: "SUCCESS" | "FAILED" | "WAITING_APPROVAL";
  output: unknown;
  evidence?: unknown;
  requestedActions?: string[];
  error?: string;
}

export interface ActionExecutionResult {
  status: "SUCCESS" | "FAILED" | "NOT_IMPLEMENTED" | "WAITING_APPROVAL";
  output?: unknown;
  error?: string;
}

export interface WorkflowApprovalRequest {
  id: string;
  workflowInstanceId: string;
  stepId: string;
  projectId: string;
  action?: string;
  reason: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "PENDING" | "APPROVED" | "REJECTED";
  minimumApprovers: number;
  approvers: string[];
  createdAt: string;
  resolvedAt?: string;
  rejectionReason?: string;
}

export interface RunStepResult {
  instanceId: string;
  workflowId: string;
  projectId: string;
  status: WorkflowStatus;
  currentStepId: string | null;
  stepId?: string;
  stepStatus?: StepRunStatus;
  message: string;
  approvalRequestId?: string;
}

export interface WorkflowObservabilitySnapshot {
  workflowId: string;
  instanceId: string;
  projectId: string;
  currentStep: string | null;
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
  steps: Array<{
    stepId: string;
    status: StepRunStatus;
    attempt: number;
    startedAt?: string;
    completedAt?: string;
    error?: string;
  }>;
}
