import type { BudgetService } from "./budget.service.js";
import type { BudgetPolicy, PeriodPreset } from "./cost.types.js";
import { limitForPreset } from "./budget.service.js";

export type CostAlertEventType = "AI_BUDGET_WARNING" | "AI_BUDGET_BLOCKED";

export interface CostAlertEvent {
  type: CostAlertEventType;
  scope: BudgetPolicy["scope"];
  scopeId: string;
  period: PeriodPreset;
  usageUsd: number;
  limitUsd: number;
  usagePercent: number;
  message: string;
  timestamp: string;
}

/**
 * Alert abstraction for future Slack/monitoring integration.
 * No scheduler and no automatic Slack send in this phase.
 */
export interface CostAlertSink {
  emit(event: CostAlertEvent): void;
}

export class InMemoryCostAlertSink implements CostAlertSink {
  readonly events: CostAlertEvent[] = [];
  emit(event: CostAlertEvent): void {
    this.events.push(event);
  }
}

export class CostAlertService {
  constructor(
    private readonly budgets: BudgetService,
    private readonly sink: CostAlertSink = new InMemoryCostAlertSink(),
  ) {}

  checkWarnings(): CostAlertEvent[] {
    return this.scan("WARNING");
  }

  checkBlocks(): CostAlertEvent[] {
    return this.scan("BLOCK");
  }

  private scan(mode: "WARNING" | "BLOCK"): CostAlertEvent[] {
    const events: CostAlertEvent[] = [];
    const presets: PeriodPreset[] = ["day", "week", "month"];

    for (const policy of this.budgets.listBudgets()) {
      for (const preset of presets) {
        const limit = limitForPreset(policy, preset);
        if (limit === null) continue;
        const snap = this.budgets.snapshot(policy.scope, policy.scopeId, preset);
        const percent = snap.usagePercent ?? 0;
        const isBlock = percent >= policy.blockThresholdPercent;
        const isWarn =
          percent >= policy.warningThresholdPercent && !isBlock;

        if (mode === "BLOCK" && isBlock) {
          const event: CostAlertEvent = {
            type: "AI_BUDGET_BLOCKED",
            scope: policy.scope,
            scopeId: policy.scopeId,
            period: preset,
            usageUsd: snap.usageUsd,
            limitUsd: limit,
            usagePercent: percent,
            message: `${policy.scope}:${policy.scopeId} blocked at ${percent.toFixed(0)}% of ${preset} limit`,
            timestamp: new Date().toISOString(),
          };
          this.sink.emit(event);
          events.push(event);
        }
        if (mode === "WARNING" && isWarn) {
          const event: CostAlertEvent = {
            type: "AI_BUDGET_WARNING",
            scope: policy.scope,
            scopeId: policy.scopeId,
            period: preset,
            usageUsd: snap.usageUsd,
            limitUsd: limit,
            usagePercent: percent,
            message: `${policy.scope}:${policy.scopeId} warning at ${percent.toFixed(0)}% of ${preset} limit`,
            timestamp: new Date().toISOString(),
          };
          this.sink.emit(event);
          events.push(event);
        }
      }
    }

    return events;
  }
}
