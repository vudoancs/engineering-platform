import type { BudgetPolicy, BudgetScope, PeriodPreset, TimePeriod } from "./cost.types.js";
import type { BudgetStore } from "./budget-store.js";
import type { UsageStore } from "./usage-store.js";
import { resolvePeriod } from "./usage.service.js";
import { microsToUsd, usdToMicros } from "./cost.service.js";

export interface BudgetUsageSnapshot {
  scope: BudgetScope;
  scopeId: string;
  period: TimePeriod;
  periodPreset: PeriodPreset;
  limitUsd: number | null;
  usageUsd: number;
  remainingUsd: number | null;
  usagePercent: number | null;
}

/**
 * Evaluates budget limits against recorded usage.
 */
export class BudgetService {
  constructor(
    private readonly budgets: BudgetStore,
    private readonly usage: UsageStore,
  ) {}

  getBudget(scope: BudgetScope, scopeId: string): BudgetPolicy | undefined {
    return this.budgets.get(scope, scopeId);
  }

  listBudgets(): BudgetPolicy[] {
    return this.budgets.list();
  }

  getUsage(
    scope: BudgetScope,
    scopeId: string,
    period: TimePeriod | PeriodPreset,
  ): number {
    const p = typeof period === "string" ? resolvePeriod(period) : period;
    const summary = this.usage.getSummary(p);
    switch (scope) {
      case "GLOBAL":
        return summary.totalCostUsd;
      case "PROJECT":
        return summary.byProject[scopeId] ?? 0;
      case "MEMBER":
        return summary.byMember[scopeId] ?? 0;
      case "AGENT":
        return summary.byAgent[scopeId] ?? 0;
      default:
        return 0;
    }
  }

  getRemainingBudget(
    scope: BudgetScope,
    scopeId: string,
    periodPreset: PeriodPreset,
  ): number | null {
    const snap = this.snapshot(scope, scopeId, periodPreset);
    return snap.remainingUsd;
  }

  snapshot(
    scope: BudgetScope,
    scopeId: string,
    periodPreset: PeriodPreset,
    now?: Date,
  ): BudgetUsageSnapshot {
    const period = resolvePeriod(periodPreset, now);
    const policy = this.budgets.get(scope, scopeId);
    const limitUsd = policy ? limitForPreset(policy, periodPreset) : null;
    const usageUsd = this.getUsage(scope, scopeId, period);
    if (limitUsd === null) {
      return {
        scope,
        scopeId,
        period,
        periodPreset,
        limitUsd: null,
        usageUsd,
        remainingUsd: null,
        usagePercent: null,
      };
    }
    const remainingMicros = Math.max(
      0,
      usdToMicros(limitUsd) - usdToMicros(usageUsd),
    );
    const usagePercent =
      limitUsd <= 0 ? 100 : (usageUsd / limitUsd) * 100;
    return {
      scope,
      scopeId,
      period,
      periodPreset,
      limitUsd,
      usageUsd,
      remainingUsd: microsToUsd(remainingMicros),
      usagePercent,
    };
  }

  /**
   * Applicable budgets for a request context (GLOBAL + optional PROJECT/MEMBER/AGENT).
   */
  applicableBudgets(input: {
    projectId?: string;
    memberId?: string;
    agentId?: string;
  }): BudgetPolicy[] {
    const out: BudgetPolicy[] = [];
    const global = this.budgets.get("GLOBAL", "global");
    if (global) out.push(global);
    if (input.projectId) {
      const p = this.budgets.get("PROJECT", input.projectId);
      if (p) out.push(p);
    }
    if (input.memberId) {
      const m = this.budgets.get("MEMBER", input.memberId);
      if (m) out.push(m);
    }
    if (input.agentId) {
      const a = this.budgets.get("AGENT", input.agentId);
      if (a) out.push(a);
    }
    return out;
  }
}

export function limitForPreset(
  policy: BudgetPolicy,
  preset: PeriodPreset,
): number | null {
  if (preset === "day") return policy.dailyLimitUsd ?? null;
  if (preset === "week") return policy.weeklyLimitUsd ?? null;
  return policy.monthlyLimitUsd ?? null;
}
