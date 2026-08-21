import type { AuditService } from "../governance/audit.service.js";
import type { WorkflowAuditEvent } from "./workflow.types.js";

export interface WorkflowAuditRecordInput {
  event: WorkflowAuditEvent;
  projectId: string;
  requestId: string;
  actor?: string;
  reason: string;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  details?: Record<string, unknown>;
}

export function withOptionalActor(actor: string | undefined): { actor?: string } {
  return actor !== undefined ? { actor } : {};
}

/**
 * Maps workflow events onto existing AuditService (no secrets).
 */
export class WorkflowAuditRecorder {
  constructor(private readonly audit: AuditService) {}

  record(input: WorkflowAuditRecordInput): void {
    this.audit.record({
      timestamp: new Date().toISOString(),
      requestId: input.requestId,
      projectId: input.projectId,
      actor: input.actor ?? "workflow",
      action: input.event,
      decision: mapDecision(input.event),
      riskLevel: input.riskLevel ?? "LOW",
      reason: input.details
        ? `${input.reason} | ${JSON.stringify(input.details)}`
        : input.reason,
    });
  }
}

function mapDecision(
  event: WorkflowAuditEvent,
): "ALLOW" | "HUMAN_APPROVAL" | "DENY" {
  switch (event) {
    case "APPROVAL_REQUESTED":
      return "HUMAN_APPROVAL";
    case "APPROVAL_REJECTED":
    case "STEP_FAILED":
    case "WORKFLOW_FAILED":
    case "WORKFLOW_CANCELLED":
      return "DENY";
    default:
      return "ALLOW";
  }
}
