import { randomUUID } from "node:crypto";
import type { WorkflowInstance, WorkflowObservabilitySnapshot } from "./workflow.types.js";
import { WorkflowInstanceNotFoundError } from "./workflow-errors.js";

export interface WorkflowStateStore {
  save(instance: WorkflowInstance): void;
  get(instanceId: string): WorkflowInstance | undefined;
  list(): WorkflowInstance[];
  update(instance: WorkflowInstance): void;
}

export class InMemoryWorkflowStateStore implements WorkflowStateStore {
  private readonly instances = new Map<string, WorkflowInstance>();

  save(instance: WorkflowInstance): void {
    this.instances.set(instance.id, structuredClone(instance));
  }

  get(instanceId: string): WorkflowInstance | undefined {
    const found = this.instances.get(instanceId);
    return found ? structuredClone(found) : undefined;
  }

  list(): WorkflowInstance[] {
    return [...this.instances.values()].map((i) => structuredClone(i));
  }

  update(instance: WorkflowInstance): void {
    if (!this.instances.has(instance.id)) {
      throw new WorkflowInstanceNotFoundError(instance.id);
    }
    instance.updatedAt = new Date().toISOString();
    this.instances.set(instance.id, structuredClone(instance));
  }
}

export function createInstanceId(): string {
  return randomUUID();
}

export function buildIdempotencyKey(
  projectId: string,
  instanceId: string,
  stepId: string,
): string {
  return `${projectId}:${instanceId}:${stepId}`;
}

export function toObservabilitySnapshot(
  instance: WorkflowInstance,
): WorkflowObservabilitySnapshot {
  return {
    workflowId: instance.workflowId,
    instanceId: instance.id,
    projectId: instance.projectId,
    currentStep: instance.currentStepId,
    status: instance.status,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
    steps: Object.values(instance.stepRecords).map((record) => ({
      stepId: record.stepId,
      status: record.status,
      attempt: record.attempt,
      ...(record.startedAt !== undefined ? { startedAt: record.startedAt } : {}),
      ...(record.completedAt !== undefined ? { completedAt: record.completedAt } : {}),
      ...(record.error !== undefined ? { error: record.error } : {}),
    })),
  };
}
