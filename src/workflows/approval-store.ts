import { randomUUID } from "node:crypto";
import type { WorkflowApprovalRequest } from "./workflow.types.js";
import { WorkflowError } from "./workflow-errors.js";

export interface ApprovalStore {
  create(
    input: Omit<WorkflowApprovalRequest, "id" | "status" | "approvers" | "createdAt">,
  ): WorkflowApprovalRequest;
  get(requestId: string): WorkflowApprovalRequest | undefined;
  listByInstance(instanceId: string): WorkflowApprovalRequest[];
  approve(requestId: string, approver: string): WorkflowApprovalRequest;
  reject(requestId: string, approver: string, reason: string): WorkflowApprovalRequest;
}

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly requests = new Map<string, WorkflowApprovalRequest>();

  create(
    input: Omit<WorkflowApprovalRequest, "id" | "status" | "approvers" | "createdAt">,
  ): WorkflowApprovalRequest {
    const request: WorkflowApprovalRequest = {
      id: randomUUID(),
      workflowInstanceId: input.workflowInstanceId,
      stepId: input.stepId,
      projectId: input.projectId,
      reason: input.reason,
      riskLevel: input.riskLevel,
      status: "PENDING",
      minimumApprovers: input.minimumApprovers,
      approvers: [],
      createdAt: new Date().toISOString(),
    };
    if (input.action !== undefined) {
      request.action = input.action;
    }
    this.requests.set(request.id, request);
    return request;
  }

  get(requestId: string): WorkflowApprovalRequest | undefined {
    const found = this.requests.get(requestId);
    return found ? structuredClone(found) : undefined;
  }

  listByInstance(instanceId: string): WorkflowApprovalRequest[] {
    return [...this.requests.values()]
      .filter((r) => r.workflowInstanceId === instanceId)
      .map((r) => structuredClone(r));
  }

  approve(requestId: string, approver: string): WorkflowApprovalRequest {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new WorkflowError(`Approval request "${requestId}" not found`, {
        code: "WORKFLOW_APPROVAL_ERROR",
      });
    }
    if (request.status !== "PENDING") {
      throw new WorkflowError(`Approval request "${requestId}" is ${request.status}`, {
        code: "WORKFLOW_APPROVAL_ERROR",
      });
    }
    if (!request.approvers.includes(approver)) {
      request.approvers.push(approver);
    }
    if (request.approvers.length >= request.minimumApprovers) {
      request.status = "APPROVED";
      request.resolvedAt = new Date().toISOString();
    }
    return structuredClone(request);
  }

  reject(requestId: string, approver: string, reason: string): WorkflowApprovalRequest {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new WorkflowError(`Approval request "${requestId}" not found`, {
        code: "WORKFLOW_APPROVAL_ERROR",
      });
    }
    if (request.status !== "PENDING") {
      throw new WorkflowError(`Approval request "${requestId}" is ${request.status}`, {
        code: "WORKFLOW_APPROVAL_ERROR",
      });
    }
    request.status = "REJECTED";
    request.approvers = [approver];
    request.rejectionReason = reason;
    request.resolvedAt = new Date().toISOString();
    return structuredClone(request);
  }
}
