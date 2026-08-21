import { randomUUID } from "node:crypto";
import type { AuditService } from "../governance/audit.service.js";
import { CostService } from "./cost.service.js";
import type { CostSummary, PeriodPreset, TimePeriod } from "./cost.types.js";
import type { UsageStore } from "./usage-store.js";
import type { AIUsageEvent, RecordUsageInput } from "./usage.types.js";
import { CostError } from "./cost-errors.js";

export function resolvePeriod(
  preset: PeriodPreset,
  now: Date = new Date(),
): TimePeriod {
  const to = now.toISOString();
  const fromDate = new Date(now);
  if (preset === "day") {
    fromDate.setUTCHours(0, 0, 0, 0);
  } else if (preset === "week") {
    fromDate.setUTCDate(fromDate.getUTCDate() - 7);
  } else {
    fromDate.setUTCDate(1);
    fromDate.setUTCHours(0, 0, 0, 0);
  }
  return { from: fromDate.toISOString(), to };
}

export interface UsageServiceOptions {
  store: UsageStore;
  costService: CostService;
  audit?: AuditService;
}

/**
 * Records actual AI usage after provider execution (idempotent on requestId).
 */
export class UsageService {
  private readonly store: UsageStore;
  private readonly costService: CostService;
  private readonly audit?: AuditService;

  constructor(options: UsageServiceOptions) {
    this.store = options.store;
    this.costService = options.costService;
    if (options.audit) this.audit = options.audit;
  }

  record(input: RecordUsageInput): {
    event: AIUsageEvent;
    duplicate: boolean;
  } {
    if (!input.projectId?.trim()) {
      throw new CostError("projectId is required to record usage", {
        code: "MISSING_PROJECT",
      });
    }
    if (input.inputTokens < 0 || input.outputTokens < 0) {
      throw new CostError("Token counts must be non-negative", {
        code: "INVALID_USAGE",
      });
    }

    const existing = this.store.getByRequest(input.requestId);
    if (existing) {
      return { event: existing, duplicate: true };
    }

    const breakdown = this.costService.calculate({
      provider: input.provider,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
    });

    const event: AIUsageEvent = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      requestId: input.requestId,
      projectId: input.projectId,
      ...(input.memberId !== undefined ? { memberId: input.memberId } : {}),
      ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
      ...(input.workflowId !== undefined ? { workflowId: input.workflowId } : {}),
      ...(input.workflowInstanceId !== undefined
        ? { workflowInstanceId: input.workflowInstanceId }
        : {}),
      provider: input.provider,
      model: input.model,
      operation: input.operation ?? "chat",
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens: input.inputTokens + input.outputTokens,
      ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
      success: input.success,
      estimatedCostUsd: breakdown.totalCostUsd,
      actualCostUsd: true,
    };

    const result = this.store.record(event);
    if (this.audit) {
      this.audit.record({
        timestamp: event.timestamp,
        requestId: `${input.requestId}:AI_USAGE_RECORDED`,
        projectId: input.projectId,
        actor: input.memberId ?? input.agentId ?? "system",
        action: "AI_USAGE_RECORDED",
        decision: "ALLOW",
        riskLevel: "LOW",
        reason: `usage recorded costUsd=${breakdown.totalCostUsd} tokens=${event.totalTokens} duplicate=${result.duplicate}`,
      });
    }

    return { event, duplicate: result.duplicate };
  }

  getSummary(period: TimePeriod | PeriodPreset): CostSummary {
    const p = typeof period === "string" ? resolvePeriod(period) : period;
    return this.store.getSummary(p);
  }

  getStore(): UsageStore {
    return this.store;
  }
}
