import type { AgentService } from "../agents/agent.service.js";
import type { GovernanceService } from "../governance/governance.service.js";
import type { ActionExecutor } from "./action-executor.js";
import { WORKFLOW_ACTIONS } from "./action-executor.js";
import type { AgentExecutor } from "./agent-executor.js";
import type { ApprovalStore } from "./approval-store.js";
import { evaluateCondition } from "./workflow-conditions.js";
import {
  assertProjectIdImmutable,
  mergeContextVariables,
} from "./workflow-context.js";
import {
  WorkflowError,
  WorkflowInstanceNotFoundError,
  WorkflowTimeoutError,
} from "./workflow-errors.js";
import { withOptionalActor, type WorkflowAuditRecorder } from "./workflow-audit.js";
import {
  buildIdempotencyKey,
  type WorkflowStateStore,
} from "./workflow-state.js";
import {
  DEFAULT_STEP_TIMEOUT_MS,
  type RunStepResult,
  type StepExecutionRecord,
  type WorkflowDefinition,
  type WorkflowInstance,
  type WorkflowStep,
  type WorkflowStatus,
} from "./workflow.types.js";

export type ProjectExistenceChecker = (projectId: string) => boolean;

export interface WorkflowRunnerOptions {
  getDefinition: (workflowId: string) => WorkflowDefinition;
  stateStore: WorkflowStateStore;
  approvalStore: ApprovalStore;
  agentService: AgentService;
  agentExecutor: AgentExecutor;
  actionExecutor: ActionExecutor;
  governance: GovernanceService;
  audit: WorkflowAuditRecorder;
  isProjectKnown?: ProjectExistenceChecker;
}

/**
 * Executes exactly ONE next step per `run(instanceId)` call.
 * No background workers, no autonomous loops.
 */
export class WorkflowRunner {
  private readonly getDefinition: WorkflowRunnerOptions["getDefinition"];
  private readonly stateStore: WorkflowStateStore;
  private readonly approvalStore: ApprovalStore;
  private readonly agentService: AgentService;
  private readonly agentExecutor: AgentExecutor;
  private readonly actionExecutor: ActionExecutor;
  private readonly governance: GovernanceService;
  private readonly audit: WorkflowAuditRecorder;
  private readonly isProjectKnown?: ProjectExistenceChecker;

  constructor(options: WorkflowRunnerOptions) {
    this.getDefinition = options.getDefinition;
    this.stateStore = options.stateStore;
    this.approvalStore = options.approvalStore;
    this.agentService = options.agentService;
    this.agentExecutor = options.agentExecutor;
    this.actionExecutor = options.actionExecutor;
    this.governance = options.governance;
    this.audit = options.audit;
    if (options.isProjectKnown) {
      this.isProjectKnown = options.isProjectKnown;
    }
  }

  async run(instanceId: string): Promise<RunStepResult> {
    const instance = this.requireInstance(instanceId);
    this.assertProjectBoundary(instance);

    if (
      instance.status === "COMPLETED" ||
      instance.status === "FAILED" ||
      instance.status === "CANCELLED"
    ) {
      return this.result(instance, `Instance is ${instance.status}; no work performed`);
    }

    if (instance.status === "WAITING_APPROVAL") {
      return this.result(
        instance,
        "Instance is WAITING_APPROVAL; resolve approval before continuing",
        {
          ...(instance.pendingApprovalRequestId !== undefined
            ? { approvalRequestId: instance.pendingApprovalRequestId }
            : {}),
        },
      );
    }

    const definition = this.getDefinition(instance.workflowId);
    const step = this.selectNextStep(definition, instance);
    if (!step) {
      instance.status = "COMPLETED";
      instance.currentStepId = null;
      this.stateStore.update(instance);
      this.audit.record({
        event: "WORKFLOW_COMPLETED",
        projectId: instance.projectId,
        requestId: instance.id,
        ...withOptionalActor(instance.context.actor),
        reason: "All steps completed",
      });
      return this.result(instance, "Workflow completed");
    }

    if (instance.status === "PENDING") {
      instance.status = "RUNNING";
      this.audit.record({
        event: "WORKFLOW_STARTED",
        projectId: instance.projectId,
        requestId: instance.id,
        ...withOptionalActor(instance.context.actor),
        reason: `Starting workflow ${instance.workflowId}`,
      });
    }

    instance.currentStepId = step.id;
    this.stateStore.update(instance);

    return this.executeStep(definition, instance, step);
  }

  private async executeStep(
    definition: WorkflowDefinition,
    instance: WorkflowInstance,
    step: WorkflowStep,
  ): Promise<RunStepResult> {
    const idempotencyKey = buildIdempotencyKey(instance.projectId, instance.id, step.id);
    const existing = instance.stepRecords[step.id];
    if (existing?.status === "COMPLETED") {
      return this.result(instance, `Step "${step.id}" already completed (idempotent)`, {
        stepId: step.id,
        stepStatus: "COMPLETED",
      });
    }

    const maxAttempts = step.retry?.maxAttempts ?? 1;
    const attempt = (existing?.attempt ?? 0) + 1;
    const record: StepExecutionRecord = {
      stepId: step.id,
      status: "RUNNING",
      attempt,
      startedAt: new Date().toISOString(),
      idempotencyKey,
    };
    instance.stepRecords[step.id] = record;
    instance.status = "RUNNING";
    this.stateStore.update(instance);

    this.audit.record({
      event: "STEP_STARTED",
      projectId: instance.projectId,
      requestId: instance.id,
        ...withOptionalActor(instance.context.actor),
      reason: `Step ${step.id} started (attempt ${attempt})`,
      details: { stepId: step.id, type: step.type, attempt },
    });

    try {
      if (step.enabled === false) {
        const blocked =
          step.action !== undefined
            ? `BLOCKED_BY_DISABLED_ACTION: ${step.action} is disabled by engineering policy`
            : `Step "${step.id}" is disabled`;
        throw new WorkflowError(blocked, {
          code: "WORKFLOW_STEP_ERROR",
          retryable: false,
          details: { stepId: step.id, action: step.action },
        });
      }

      if (!this.dependenciesSatisfied(step, instance)) {
        throw new WorkflowError(`Dependencies not satisfied for step "${step.id}"`, {
          code: "WORKFLOW_STEP_ERROR",
          retryable: false,
          details: { dependsOn: step.dependsOn ?? [] },
        });
      }

      const outcome = await this.dispatchStep(instance, step);

      if (outcome.kind === "waiting_approval") {
        record.status = "WAITING_APPROVAL";
        record.completedAt = new Date().toISOString();
        instance.status = "WAITING_APPROVAL";
        instance.pendingApprovalRequestId = outcome.approvalRequestId;
        instance.stepRecords[step.id] = record;
        this.stateStore.update(instance);
        return this.result(instance, outcome.message, {
          stepId: step.id,
          stepStatus: "WAITING_APPROVAL",
          approvalRequestId: outcome.approvalRequestId,
        });
      }

      if (outcome.kind === "failed") {
        return this.failStep(
          instance,
          step,
          record,
          outcome.error,
          maxAttempts,
          outcome.retryable ?? false,
        );
      }

      record.status = "COMPLETED";
      record.completedAt = new Date().toISOString();
      if (outcome.output !== undefined) {
        record.output = outcome.output;
      }
      if (outcome.contextPatch) {
        instance.context = mergeContextVariables(instance.context, outcome.contextPatch);
        assertProjectIdImmutable(instance.projectId, instance.context);
      }
      instance.stepRecords[step.id] = record;
      instance.status = "RUNNING";
      this.stateStore.update(instance);

      this.audit.record({
        event: "STEP_COMPLETED",
        projectId: instance.projectId,
        requestId: instance.id,
        ...withOptionalActor(instance.context.actor),
        reason: `Step ${step.id} completed`,
        details: { stepId: step.id },
      });

      const next = this.selectNextStep(definition, instance);
      instance.currentStepId = next?.id ?? null;
      if (!next) {
        instance.status = "COMPLETED";
        this.stateStore.update(instance);
        this.audit.record({
          event: "WORKFLOW_COMPLETED",
          projectId: instance.projectId,
          requestId: instance.id,
        ...withOptionalActor(instance.context.actor),
            reason: "All steps completed",
        });
      } else {
        this.stateStore.update(instance);
      }

      return this.result(instance, `Step "${step.id}" completed`, {
        stepId: step.id,
        stepStatus: "COMPLETED",
      });
    } catch (error) {
      const retryable = error instanceof WorkflowError ? error.retryable : false;
      const message = error instanceof Error ? error.message : "Unknown step error";
      return this.failStep(instance, step, record, message, maxAttempts, retryable);
    }
  }

  private async dispatchStep(
    instance: WorkflowInstance,
    step: WorkflowStep,
  ): Promise<
    | { kind: "success"; output?: unknown; contextPatch?: Record<string, unknown> }
    | { kind: "failed"; error: string; retryable?: boolean }
    | { kind: "waiting_approval"; approvalRequestId: string; message: string }
  > {
    switch (step.type) {
      case "APPROVAL":
        return this.runApprovalStep(instance, step);
      case "CONDITION":
        return this.runConditionStep(instance, step);
      case "ACTION":
        return this.runActionStep(instance, step);
      case "AGENT":
        return this.runAgentStep(instance, step);
      default: {
        const _never: never = step.type;
        return { kind: "failed", error: `Unsupported step type: ${_never}` };
      }
    }
  }

  private runApprovalStep(
    instance: WorkflowInstance,
    step: WorkflowStep,
  ): {
    kind: "waiting_approval";
    approvalRequestId: string;
    message: string;
  } {
    const approval = step.approval!;
    const request = this.approvalStore.create({
      workflowInstanceId: instance.id,
      stepId: step.id,
      projectId: instance.projectId,
      reason: approval.reason ?? `Approval required for step ${step.id}`,
      riskLevel: approval.riskLevel ?? "MEDIUM",
      minimumApprovers: approval.minimumApprovers,
      ...(step.action !== undefined ? { action: step.action } : {}),
    });

    this.audit.record({
      event: "APPROVAL_REQUESTED",
      projectId: instance.projectId,
      requestId: instance.id,
        ...withOptionalActor(instance.context.actor),
      reason: request.reason,
      riskLevel: request.riskLevel,
      details: { approvalRequestId: request.id, stepId: step.id },
    });

    return {
      kind: "waiting_approval",
      approvalRequestId: request.id,
      message: `Approval required for step "${step.id}"`,
    };
  }

  private runConditionStep(
    instance: WorkflowInstance,
    step: WorkflowStep,
  ):
    | { kind: "success"; output: unknown; contextPatch?: Record<string, unknown> }
    | { kind: "failed"; error: string } {
    const evaluation = evaluateCondition(step.condition!, instance.context);
    if (!evaluation.passed) {
      return { kind: "failed", error: evaluation.reason };
    }
    return {
      kind: "success",
      output: evaluation,
      contextPatch: { [`condition.${step.condition}`]: true },
    };
  }

  private async runActionStep(
    instance: WorkflowInstance,
    step: WorkflowStep,
  ): Promise<
    | { kind: "success"; output?: unknown; contextPatch?: Record<string, unknown> }
    | { kind: "failed"; error: string; retryable?: boolean }
    | { kind: "waiting_approval"; approvalRequestId: string; message: string }
  > {
    const actionId = step.action!;
    const actionDef = WORKFLOW_ACTIONS[actionId];
    if (!actionDef) {
      return { kind: "failed", error: `Unknown action "${actionId}"` };
    }

    const decision = this.governance.evaluate({
      projectId: instance.projectId,
      action: actionDef.governanceAction,
      ...withOptionalActor(instance.context.actor),
      requestId: `${instance.id}:${step.id}`,
      context: {
        ...(instance.context.repository !== undefined
          ? { repository: instance.context.repository }
          : {}),
        ...(instance.context.branch !== undefined ? { branch: instance.context.branch } : {}),
        ...(instance.context.pullRequestNumber !== undefined
          ? { pullRequestNumber: instance.context.pullRequestNumber }
          : {}),
        ...(instance.context.issueKey !== undefined
          ? { issueKey: instance.context.issueKey }
          : {}),
      },
    });

    if (decision.decision === "DENY") {
      return {
        kind: "failed",
        error: `Governance DENY for ${actionDef.governanceAction}: ${decision.reason}`,
        retryable: false,
      };
    }

    if (decision.decision === "HUMAN_APPROVAL") {
      const request = this.approvalStore.create({
        workflowInstanceId: instance.id,
        stepId: step.id,
        projectId: instance.projectId,
        action: actionDef.governanceAction,
        reason: decision.reason,
        riskLevel: decision.riskLevel,
        minimumApprovers: 1,
      });
      this.audit.record({
        event: "APPROVAL_REQUESTED",
        projectId: instance.projectId,
        requestId: instance.id,
        ...withOptionalActor(instance.context.actor),
        reason: decision.reason,
        riskLevel: decision.riskLevel,
        details: { approvalRequestId: request.id, stepId: step.id },
      });
      return {
        kind: "waiting_approval",
        approvalRequestId: request.id,
        message: `Governance requires approval for ${actionDef.governanceAction}`,
      };
    }

    const timeoutMs = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    const result = await withTimeout(
      this.actionExecutor.execute(actionId, instance.context),
      timeoutMs,
      step.id,
    );

    if (result.status === "NOT_IMPLEMENTED") {
      return {
        kind: "failed",
        error: result.error ?? `Action "${actionId}" NOT_IMPLEMENTED`,
        retryable: false,
      };
    }
    if (result.status === "FAILED") {
      return { kind: "failed", error: result.error ?? "Action failed", retryable: true };
    }
    if (result.status === "WAITING_APPROVAL") {
      return {
        kind: "failed",
        error: "Action executor returned WAITING_APPROVAL unexpectedly",
      };
    }

    return {
      kind: "success",
      output: result.output,
      contextPatch: { [`action.${actionId}`]: result.output },
    };
  }

  private async runAgentStep(
    instance: WorkflowInstance,
    step: WorkflowStep,
  ): Promise<
    | { kind: "success"; output?: unknown; contextPatch?: Record<string, unknown> }
    | { kind: "failed"; error: string; retryable?: boolean }
  > {
    const agentId = step.agent!;
    this.agentService.validateAgent(agentId);
    this.agentService.assertProjectContext(instance.projectId);

    const cacheKey = `agent.${agentId}.${step.id}`;
    if (instance.context.variables[cacheKey] !== undefined) {
      return {
        kind: "success",
        output: instance.context.variables[cacheKey],
        contextPatch: {},
      };
    }

    const agent = this.agentService.getAgent(agentId);
    const timeoutMs = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    const result = await withTimeout(
      this.agentExecutor.execute({
        agentId,
        projectId: instance.projectId,
        workflowInstanceId: instance.id,
        stepId: step.id,
        context: instance.context,
        instructions: agent.instructions,
        allowedTools: agent.allowedTools,
      }),
      timeoutMs,
      step.id,
    );

    if (result.status === "FAILED") {
      return {
        kind: "failed",
        error: result.error ?? "Agent execution failed",
        retryable: true,
      };
    }
    if (result.status === "WAITING_APPROVAL") {
      return {
        kind: "failed",
        error: "Agent requested approval; use APPROVAL steps instead",
        retryable: false,
      };
    }

    const patch: Record<string, unknown> = {
      [cacheKey]: result.output,
    };
    if (agentId === "reviewer" && result.output && typeof result.output === "object") {
      const risk = (result.output as { riskLevel?: string }).riskLevel;
      if (risk) {
        patch.riskLevel = risk;
      }
    }

    return { kind: "success", output: result.output, contextPatch: patch };
  }

  private failStep(
    instance: WorkflowInstance,
    step: WorkflowStep,
    record: StepExecutionRecord,
    error: string,
    maxAttempts: number,
    retryable = false,
  ): RunStepResult {
    record.error = error;
    record.completedAt = new Date().toISOString();

    const canRetry = retryable && record.attempt < maxAttempts;
    if (canRetry) {
      record.status = "FAILED";
      instance.stepRecords[step.id] = record;
      instance.status = "RUNNING";
      this.stateStore.update(instance);
      this.audit.record({
        event: "STEP_FAILED",
        projectId: instance.projectId,
        requestId: instance.id,
        ...withOptionalActor(instance.context.actor),
        reason: `Step ${step.id} failed (retryable): ${error}`,
        details: { stepId: step.id, attempt: record.attempt, willRetry: true },
      });
      return this.result(instance, `Step "${step.id}" failed (retryable): ${error}`, {
        stepId: step.id,
        stepStatus: "FAILED",
      });
    }

    record.status = "FAILED";
    instance.stepRecords[step.id] = record;
    instance.status = "FAILED";
    this.stateStore.update(instance);
    this.audit.record({
      event: "STEP_FAILED",
      projectId: instance.projectId,
      requestId: instance.id,
        ...withOptionalActor(instance.context.actor),
      reason: `Step ${step.id} failed: ${error}`,
      details: { stepId: step.id, attempt: record.attempt },
    });
    this.audit.record({
      event: "WORKFLOW_FAILED",
      projectId: instance.projectId,
      requestId: instance.id,
        ...withOptionalActor(instance.context.actor),
      reason: `Workflow failed at step ${step.id}`,
    });
    return this.result(instance, `Step "${step.id}" failed: ${error}`, {
      stepId: step.id,
      stepStatus: "FAILED",
    });
  }

  private selectNextStep(
    definition: WorkflowDefinition,
    instance: WorkflowInstance,
  ): WorkflowStep | null {
    for (const step of definition.steps) {
      const record = instance.stepRecords[step.id];
      if (record?.status === "COMPLETED") continue;
      if (record?.status === "WAITING_APPROVAL") return step;
      if (!this.dependenciesSatisfied(step, instance)) continue;
      return step;
    }
    return null;
  }

  private dependenciesSatisfied(step: WorkflowStep, instance: WorkflowInstance): boolean {
    for (const dep of step.dependsOn ?? []) {
      if (instance.stepRecords[dep]?.status !== "COMPLETED") {
        return false;
      }
    }
    return true;
  }

  private assertProjectBoundary(instance: WorkflowInstance): void {
    assertProjectIdImmutable(instance.projectId, instance.context);
    if (this.isProjectKnown && !this.isProjectKnown(instance.projectId)) {
      throw new WorkflowError(`Unknown project "${instance.projectId}" (fail closed)`, {
        code: "WORKFLOW_PROJECT_DENIED",
        retryable: false,
        details: { projectId: instance.projectId },
      });
    }
  }

  private requireInstance(instanceId: string): WorkflowInstance {
    const instance = this.stateStore.get(instanceId);
    if (!instance) {
      throw new WorkflowInstanceNotFoundError(instanceId);
    }
    return instance;
  }

  private result(
    instance: WorkflowInstance,
    message: string,
    extra: {
      stepId?: string;
      stepStatus?: RunStepResult["stepStatus"];
      approvalRequestId?: string;
    } = {},
  ): RunStepResult {
    const out: RunStepResult = {
      instanceId: instance.id,
      workflowId: instance.workflowId,
      projectId: instance.projectId,
      status: instance.status as WorkflowStatus,
      currentStepId: instance.currentStepId,
      message,
    };
    if (extra.stepId !== undefined) out.stepId = extra.stepId;
    if (extra.stepStatus !== undefined) out.stepStatus = extra.stepStatus;
    if (extra.approvalRequestId !== undefined) {
      out.approvalRequestId = extra.approvalRequestId;
    } else if (instance.pendingApprovalRequestId !== undefined) {
      out.approvalRequestId = instance.pendingApprovalRequestId;
    }
    return out;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  stepId: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new WorkflowTimeoutError(stepId, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
