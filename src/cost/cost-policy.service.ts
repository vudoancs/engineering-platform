import type { AuditService } from "../governance/audit.service.js";
import { BudgetBlockedError, MissingProjectError } from "./cost-errors.js";
import type { BudgetService } from "./budget.service.js";
import { limitForPreset } from "./budget.service.js";
import type {
  BudgetScope,
  CostCheckRequest,
  CostDecision,
  PeriodPreset,
} from "./cost.types.js";
import { usdToMicros, microsToUsd } from "./cost.service.js";

export interface CostPolicyServiceOptions {
  budgetService: BudgetService;
  audit?: AuditService;
  /** Periods evaluated on each check (strictest wins across all). */
  periods?: PeriodPreset[];
}

/**
 * Cost governance — runs BEFORE expensive AI provider execution.
 */
export class CostPolicyService {
  private readonly budgets: BudgetService;
  private readonly audit?: AuditService;
  private readonly periods: PeriodPreset[];

  constructor(options: CostPolicyServiceOptions) {
    this.budgets = options.budgetService;
    if (options.audit) this.audit = options.audit;
    this.periods = options.periods ?? ["day", "week", "month"];
  }

  checkBudget(request: CostCheckRequest): CostDecision {
    if (!request.projectId?.trim() && !request.globalSystemOperation) {
      throw new MissingProjectError();
    }

    const estimated = Math.max(0, request.estimatedCostUsd);
    const policies = this.budgets.applicableBudgets({
      ...(request.projectId ? { projectId: request.projectId } : {}),
      ...(request.memberId ? { memberId: request.memberId } : {}),
      ...(request.agentId ? { agentId: request.agentId } : {}),
    });

    let decision: CostDecision = {
      decision: "ALLOW",
      estimatedCostUsd: estimated,
      currentUsageUsd: 0,
      remainingBudgetUsd: Number.POSITIVE_INFINITY,
      reason: "No applicable budget limits",
    };

    let worstRank = 0; // ALLOW=0 WARNING=1 BLOCK=2
    let minRemainingMicros = Number.POSITIVE_INFINITY;

    for (const policy of policies) {
      for (const preset of this.periods) {
        const limit = limitForPreset(policy, preset);
        if (limit === null) continue;

        const usage = this.budgets.getUsage(
          policy.scope,
          policy.scopeId,
          preset,
        );
        const projected = microsToUsd(
          usdToMicros(usage) + usdToMicros(estimated),
        );
        const percent = limit <= 0 ? 100 : (projected / limit) * 100;
        const remainingMicros = Math.max(
          0,
          usdToMicros(limit) - usdToMicros(projected),
        );
        if (remainingMicros < minRemainingMicros) {
          minRemainingMicros = remainingMicros;
        }

        let local: CostDecision["decision"] = "ALLOW";
        let reason = `${policy.scope}:${policy.scopeId} ${preset} at ${percent.toFixed(1)}%`;

        if (percent >= policy.blockThresholdPercent) {
          local = "BLOCK";
          reason = `${labelScope(policy.scope, policy.scopeId)} AI budget is at ${percent.toFixed(0)}% of ${preset}ly limit (block).`;
        } else if (percent >= policy.warningThresholdPercent) {
          local = "WARNING";
          reason = `${labelScope(policy.scope, policy.scopeId)} AI budget is at ${percent.toFixed(0)}% of ${preset}ly limit.`;
        }

        const rank = local === "BLOCK" ? 2 : local === "WARNING" ? 1 : 0;
        if (rank > worstRank) {
          worstRank = rank;
          decision = {
            decision: local,
            estimatedCostUsd: estimated,
            currentUsageUsd: usage,
            remainingBudgetUsd: microsToUsd(remainingMicros),
            reason,
            bindingScope: policy.scope,
            bindingScopeId: policy.scopeId,
            usagePercent: percent,
          };
        } else if (rank === worstRank && rank > 0) {
          // Keep the highest percent among same severity
          if ((decision.usagePercent ?? 0) < percent) {
            decision = {
              decision: local,
              estimatedCostUsd: estimated,
              currentUsageUsd: usage,
              remainingBudgetUsd: microsToUsd(remainingMicros),
              reason,
              bindingScope: policy.scope,
              bindingScopeId: policy.scopeId,
              usagePercent: percent,
            };
          }
        } else if (worstRank === 0) {
          decision = {
            decision: "ALLOW",
            estimatedCostUsd: estimated,
            currentUsageUsd: usage,
            remainingBudgetUsd: microsToUsd(remainingMicros),
            reason: "Within AI budget limits",
            bindingScope: policy.scope,
            bindingScopeId: policy.scopeId,
            usagePercent: percent,
          };
        }
      }
    }

    if (minRemainingMicros !== Number.POSITIVE_INFINITY) {
      decision.remainingBudgetUsd = microsToUsd(minRemainingMicros);
    }

    this.auditCheck(request, decision);
    return decision;
  }

  /**
   * Assert ALLOW/WARNING; throw on BLOCK so callers never hit the provider.
   */
  assertAllowed(request: CostCheckRequest): CostDecision {
    const decision = this.checkBudget(request);
    if (decision.decision === "BLOCK") {
      throw new BudgetBlockedError(decision.reason, {
        bindingScope: decision.bindingScope,
        bindingScopeId: decision.bindingScopeId,
        usagePercent: decision.usagePercent,
      });
    }
    return decision;
  }

  private auditCheck(request: CostCheckRequest, decision: CostDecision): void {
    if (!this.audit) return;
    const action =
      decision.decision === "BLOCK"
        ? "AI_BUDGET_BLOCKED"
        : decision.decision === "WARNING"
          ? "AI_BUDGET_WARNING"
          : "AI_COST_CHECKED";
    this.audit.record({
      timestamp: new Date().toISOString(),
      requestId: `${request.requestId}:${action}`,
      projectId: request.projectId ?? "GLOBAL_SYSTEM",
      actor: request.memberId ?? request.agentId ?? "system",
      action,
      decision:
        decision.decision === "BLOCK"
          ? "DENY"
          : decision.decision === "WARNING"
            ? "HUMAN_APPROVAL"
            : "ALLOW",
      riskLevel: decision.decision === "BLOCK" ? "HIGH" : "LOW",
      reason: decision.reason,
    });
  }
}

function labelScope(scope: BudgetScope, scopeId: string): string {
  if (scope === "GLOBAL") return "Global";
  if (scope === "PROJECT") return scopeId.charAt(0).toUpperCase() + scopeId.slice(1);
  if (scope === "AGENT") return `Agent ${scopeId}`;
  return `Member ${scopeId}`;
}
