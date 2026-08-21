import type { AgentService } from "../agents/agent.service.js";
import type { AuditService } from "../governance/audit.service.js";
import { InMemoryAuditService } from "../governance/audit.service.js";
import type { GovernanceService } from "../governance/governance.service.js";
import {
  StubActionExecutor,
  type ActionExecutor,
} from "./action-executor.js";
import {
  MockAgentExecutor,
  type AgentExecutor,
} from "./agent-executor.js";
import {
  InMemoryApprovalStore,
  type ApprovalStore,
} from "./approval-store.js";
import { WorkflowAuditRecorder, withOptionalActor } from "./workflow-audit.js";
import { createWorkflowContext } from "./workflow-context.js";
import {
  WorkflowError,
  WorkflowInstanceNotFoundError,
  WorkflowNotFoundError,
} from "./workflow-errors.js";
import { WorkflowLoader } from "./workflow-loader.js";
import { WorkflowRunner } from "./workflow-runner.js";
import {
  createInstanceId,
  InMemoryWorkflowStateStore,
  toObservabilitySnapshot,
  type WorkflowStateStore,
} from "./workflow-state.js";
import type {
  RunStepResult,
  WorkflowApprovalRequest,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowObservabilitySnapshot,
  WorkflowSummary,
} from "./workflow.types.js";

export type ProjectExistenceChecker = (projectId: string) => boolean;

export interface WorkflowServiceOptions {
  workflowsDir: string;
  agentService: AgentService;
  governance: GovernanceService;
  knownAgentIds?: ReadonlySet<string> | readonly string[];
  stateStore?: WorkflowStateStore;
  approvalStore?: ApprovalStore;
  auditService?: AuditService;
  agentExecutor?: AgentExecutor;
  actionExecutor?: ActionExecutor;
  isProjectKnown?: ProjectExistenceChecker;
}

/**
 * Workflow definition + instance management. Explicit step execution via runner.
 */
export class WorkflowService {
  private readonly workflows: Map<string, WorkflowDefinition>;
  private readonly stateStore: WorkflowStateStore;
  private readonly approvalStore: ApprovalStore;
  private readonly audit: WorkflowAuditRecorder;
  private readonly runner: WorkflowRunner;
  private readonly isProjectKnown?: ProjectExistenceChecker;

  constructor(options: WorkflowServiceOptions) {
    const knownAgentIds =
      options.knownAgentIds ??
      new Set(options.agentService.listAgents().map((a) => a.id));

    const loader = new WorkflowLoader({
      workflowsDir: options.workflowsDir,
      knownAgentIds,
    });
    const loaded = loader.loadAll();
    this.workflows = new Map(loaded.map((wf) => [wf.id, wf]));

    this.stateStore = options.stateStore ?? new InMemoryWorkflowStateStore();
    this.approvalStore = options.approvalStore ?? new InMemoryApprovalStore();
    const auditService = options.auditService ?? new InMemoryAuditService();
    this.audit = new WorkflowAuditRecorder(auditService);
    if (options.isProjectKnown) {
      this.isProjectKnown = options.isProjectKnown;
    }

    this.runner = new WorkflowRunner({
      getDefinition: (id) => this.getWorkflow(id),
      stateStore: this.stateStore,
      approvalStore: this.approvalStore,
      agentService: options.agentService,
      agentExecutor: options.agentExecutor ?? new MockAgentExecutor(),
      actionExecutor: options.actionExecutor ?? new StubActionExecutor(),
      governance: options.governance,
      audit: this.audit,
      ...(options.isProjectKnown ? { isProjectKnown: options.isProjectKnown } : {}),
    });
  }

  static loadFromDirectory(options: WorkflowServiceOptions): WorkflowService {
    return new WorkflowService(options);
  }

  listWorkflows(): WorkflowSummary[] {
    return [...this.workflows.values()]
      .map((wf) => ({
        id: wf.id,
        name: wf.name,
        version: wf.version,
        description: wf.description,
        stepCount: wf.steps.length,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  getWorkflow(workflowId: string): WorkflowDefinition {
    const wf = this.workflows.get(workflowId);
    if (!wf) {
      throw new WorkflowNotFoundError(workflowId);
    }
    return wf;
  }

  validateWorkflow(workflowId: string): { valid: true; workflowId: string } {
    const wf = this.getWorkflow(workflowId);
    return { valid: true, workflowId: wf.id };
  }

  createInstance(
    workflowId: string,
    contextInput: Omit<WorkflowContext, "variables"> & {
      variables?: Record<string, unknown>;
    },
  ): WorkflowInstance {
    const workflow = this.getWorkflow(workflowId);
    const context = createWorkflowContext(contextInput);

    if (this.isProjectKnown && !this.isProjectKnown(context.projectId)) {
      throw new WorkflowError(`Unknown project "${context.projectId}" (fail closed)`, {
        code: "WORKFLOW_PROJECT_DENIED",
        details: { projectId: context.projectId },
      });
    }

    const now = new Date().toISOString();
    const instance: WorkflowInstance = {
      id: createInstanceId(),
      workflowId: workflow.id,
      projectId: context.projectId,
      status: "PENDING",
      currentStepId: workflow.steps[0]?.id ?? null,
      context,
      stepRecords: {},
      createdAt: now,
      updatedAt: now,
    };

    this.stateStore.save(instance);
    this.audit.record({
      event: "WORKFLOW_CREATED",
      projectId: instance.projectId,
      requestId: instance.id,
      ...withOptionalActor(context.actor),
      reason: `Created instance of ${workflowId}`,
      details: { workflowId },
    });

    return this.getInstance(instance.id);
  }

  getInstance(instanceId: string): WorkflowInstance {
    const instance = this.stateStore.get(instanceId);
    if (!instance) {
      throw new WorkflowInstanceNotFoundError(instanceId);
    }
    return instance;
  }

  listInstances(): WorkflowInstance[] {
    return this.stateStore.list();
  }

  cancelInstance(instanceId: string): WorkflowInstance {
    const instance = this.getInstance(instanceId);
    if (
      instance.status === "COMPLETED" ||
      instance.status === "CANCELLED" ||
      instance.status === "FAILED"
    ) {
      throw new WorkflowError(`Cannot cancel instance in status ${instance.status}`, {
        code: "WORKFLOW_STATE_ERROR",
      });
    }
    instance.status = "CANCELLED";
    delete instance.pendingApprovalRequestId;
    this.stateStore.update(instance);
    this.audit.record({
      event: "WORKFLOW_CANCELLED",
      projectId: instance.projectId,
      requestId: instance.id,
      ...withOptionalActor(instance.context.actor),
      reason: "Instance cancelled",
    });
    return this.getInstance(instanceId);
  }

  /**
   * Resume after approval: marks approval step completed and sets RUNNING.
   * Does not auto-execute the next step.
   */
  resumeInstance(instanceId: string): WorkflowInstance {
    const instance = this.getInstance(instanceId);
    if (instance.status !== "WAITING_APPROVAL" && instance.status !== "RUNNING") {
      throw new WorkflowError(
        `Cannot resume instance in status ${instance.status}`,
        { code: "WORKFLOW_STATE_ERROR" },
      );
    }
    if (instance.status === "WAITING_APPROVAL") {
      throw new WorkflowError(
        "Instance is WAITING_APPROVAL; call approve()/reject() first",
        { code: "WORKFLOW_STATE_ERROR" },
      );
    }
    return instance;
  }

  async runNextStep(instanceId: string): Promise<RunStepResult> {
    return this.runner.run(instanceId);
  }

  getRunner(): WorkflowRunner {
    return this.runner;
  }

  approve(requestId: string, approver: string): {
    request: WorkflowApprovalRequest;
    instance: WorkflowInstance;
  } {
    const request = this.approvalStore.approve(requestId, approver);
    const instance = this.getInstance(request.workflowInstanceId);

    if (request.status === "APPROVED") {
      const stepRecord = instance.stepRecords[request.stepId];
      if (stepRecord) {
        stepRecord.status = "COMPLETED";
        stepRecord.completedAt = new Date().toISOString();
      }
      delete instance.pendingApprovalRequestId;
      instance.status = "RUNNING";
      this.stateStore.update(instance);
      this.audit.record({
        event: "APPROVAL_APPROVED",
        projectId: instance.projectId,
        requestId: instance.id,
        actor: approver,
        reason: `Approval ${requestId} approved`,
        details: { stepId: request.stepId },
      });
    }

    return { request, instance: this.getInstance(instance.id) };
  }

  reject(
    requestId: string,
    approver: string,
    reason: string,
  ): {
    request: WorkflowApprovalRequest;
    instance: WorkflowInstance;
  } {
    const request = this.approvalStore.reject(requestId, approver, reason);
    const instance = this.getInstance(request.workflowInstanceId);
    const stepRecord = instance.stepRecords[request.stepId];
    if (stepRecord) {
      stepRecord.status = "FAILED";
      stepRecord.error = reason;
      stepRecord.completedAt = new Date().toISOString();
    }
    delete instance.pendingApprovalRequestId;
    instance.status = "CANCELLED";
    this.stateStore.update(instance);
    this.audit.record({
      event: "APPROVAL_REJECTED",
      projectId: instance.projectId,
      requestId: instance.id,
      actor: approver,
      reason,
      details: { stepId: request.stepId },
    });
    this.audit.record({
      event: "WORKFLOW_CANCELLED",
      projectId: instance.projectId,
      requestId: instance.id,
      actor: approver,
      reason: "Cancelled due to approval rejection",
    });
    return { request, instance: this.getInstance(instance.id) };
  }

  getApproval(requestId: string): WorkflowApprovalRequest | undefined {
    return this.approvalStore.get(requestId);
  }

  getObservability(instanceId: string): WorkflowObservabilitySnapshot {
    return toObservabilitySnapshot(this.getInstance(instanceId));
  }
}
