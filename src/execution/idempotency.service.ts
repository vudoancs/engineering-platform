import type { ExecutionResult } from "./execution.types.js";

export interface IdempotencyService {
  get(key: string): ExecutionResult | undefined;
  set(key: string, result: ExecutionResult): void;
  buildKey(parts: {
    projectId: string;
    action: string;
    requestId?: string;
    workflowInstanceId?: string;
    stepId?: string;
  }): string;
}

/**
 * In-memory idempotency store. Prevents duplicate side effects.
 */
export class InMemoryIdempotencyService implements IdempotencyService {
  private readonly store = new Map<string, ExecutionResult>();

  buildKey(parts: {
    projectId: string;
    action: string;
    requestId?: string;
    workflowInstanceId?: string;
    stepId?: string;
  }): string {
    if (parts.workflowInstanceId && parts.stepId) {
      return [
        parts.projectId,
        parts.workflowInstanceId,
        parts.stepId,
        parts.action,
      ].join(":");
    }
    if (!parts.requestId) {
      return `${parts.projectId}:anon:${parts.action}:${Date.now()}`;
    }
    return `${parts.projectId}:req:${parts.requestId}:${parts.action}`;
  }

  get(key: string): ExecutionResult | undefined {
    const found = this.store.get(key);
    return found ? structuredClone(found) : undefined;
  }

  set(key: string, result: ExecutionResult): void {
    this.store.set(key, structuredClone(result));
  }
}
