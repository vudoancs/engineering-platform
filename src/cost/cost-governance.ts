import type { AuditService } from "../governance/audit.service.js";
import { InMemoryAuditService } from "../governance/audit.service.js";
import {
  buildBudgetPolicies,
  ConfigBudgetStore,
} from "./budget-store.js";
import { BudgetService } from "./budget.service.js";
import { CostAuthorizationService } from "./cost-authorization.service.js";
import { CostAlertService } from "./cost-alert.service.js";
import { CostPolicyService } from "./cost-policy.service.js";
import { loadCostLimitsConfig } from "./cost-policy-loader.js";
import { CostReportFormatter } from "./cost-report.formatter.js";
import { CostService } from "./cost.service.js";
import type {
  CostCheckRequest,
  CostDecision,
  CostSummary,
  CostViewer,
  PeriodPreset,
} from "./cost.types.js";
import { ProviderPricingService } from "./provider-pricing.js";
import { InMemoryUsageStore } from "./usage-store.js";
import { resolvePeriod, UsageService } from "./usage.service.js";
import type { RecordUsageInput } from "./usage.types.js";

export interface CostGovernanceOptions {
  policiesDir: string;
  audit?: AuditService;
}

/**
 * Facade: estimate → budget check → (caller executes) → record usage.
 */
export class CostGovernance {
  readonly pricing: ProviderPricingService;
  readonly costService: CostService;
  readonly usageService: UsageService;
  readonly budgetService: BudgetService;
  readonly policyService: CostPolicyService;
  readonly authorization: CostAuthorizationService;
  readonly formatter: CostReportFormatter;
  readonly alerts: CostAlertService;
  readonly usageRetentionDays: number;

  constructor(options: CostGovernanceOptions) {
    const audit = options.audit ?? new InMemoryAuditService();
    this.pricing = ProviderPricingService.loadFromDirectory(options.policiesDir);
    this.costService = new CostService(this.pricing);
    const store = new InMemoryUsageStore();
    this.usageService = new UsageService({
      store,
      costService: this.costService,
      audit,
    });
    const limits = loadCostLimitsConfig(options.policiesDir);
    this.usageRetentionDays = limits.usageRetentionDays;
    const budgetStore = new ConfigBudgetStore(buildBudgetPolicies(limits));
    this.budgetService = new BudgetService(budgetStore, store);
    this.policyService = new CostPolicyService({
      budgetService: this.budgetService,
      audit,
    });
    this.authorization = new CostAuthorizationService();
    this.formatter = new CostReportFormatter();
    this.alerts = new CostAlertService(this.budgetService);
  }

  static loadFromDirectory(policiesDir: string, audit?: AuditService): CostGovernance {
    return new CostGovernance({
      policiesDir,
      ...(audit !== undefined ? { audit } : {}),
    });
  }

  /** Pre-execution: estimate + budget check. BLOCK returns decision (does not throw). */
  authorizeExecution(request: CostCheckRequest): CostDecision {
    const estimated = this.resolveEstimate(request);
    return this.policyService.checkBudget({
      ...request,
      estimatedCostUsd: estimated,
    });
  }

  /** Pre-execution: throws BudgetBlockedError when BLOCK — never call provider. */
  assertCanExecute(request: CostCheckRequest): CostDecision {
    const estimated = this.resolveEstimate(request);
    return this.policyService.assertAllowed({
      ...request,
      estimatedCostUsd: estimated,
    });
  }

  private resolveEstimate(request: CostCheckRequest): number {
    if (Number.isFinite(request.estimatedCostUsd) && request.estimatedCostUsd > 0) {
      return request.estimatedCostUsd;
    }
    return this.costService.estimate({
      provider: request.provider,
      model: request.model,
      ...(request.estimatedInputTokens !== undefined
        ? { estimatedInputTokens: request.estimatedInputTokens }
        : {}),
      ...(request.estimatedOutputTokens !== undefined
        ? { estimatedOutputTokens: request.estimatedOutputTokens }
        : {}),
    }).totalCostUsd;
  }

  /** Post-execution usage recording. */
  recordUsage(input: RecordUsageInput) {
    return this.usageService.record(input);
  }

  getSummary(period: PeriodPreset): CostSummary {
    return this.usageService.getSummary(period);
  }

  getReport(
    viewer: CostViewer,
    options: {
      period?: PeriodPreset;
      projectId?: string;
      memberId?: string;
      agentId?: string;
      provider?: string;
    } = {},
  ): { summary: CostSummary; text: string } {
    const period = options.period ?? "day";
    const full = this.usageService.getSummary(period);

    if (options.memberId) {
      this.authorization.assertCanViewMember(viewer, options.memberId);
    } else if (options.projectId) {
      this.authorization.assertCanViewProject(viewer, options.projectId);
    } else if (options.agentId) {
      this.authorization.assertCanViewAgent(viewer, options.agentId);
    } else if (options.provider) {
      this.authorization.assertCanViewProvider(viewer);
    } else if (viewer.role === "developer" || viewer.role === "reviewer") {
      if (!viewer.memberId) {
        this.authorization.assertCanViewGlobal(viewer);
      } else {
        this.authorization.assertCanViewMember(viewer, viewer.memberId);
      }
    } else {
      this.authorization.assertCanViewGlobal(viewer);
    }

    let summary = full;
    if (options.projectId) {
      const p = resolvePeriod(period);
      const events = this.usageService
        .getStore()
        .getByProject(options.projectId, p);
      summary = this.usageService.getStore().getSummary(p);
      // Filter to project-only view
      const cost = events.reduce((s, e) => s + e.estimatedCostUsd, 0);
      summary = {
        ...full,
        totalCostUsd: Math.round(cost * 1_000_000) / 1_000_000,
        totalTokens: events.reduce((s, e) => s + e.totalTokens, 0),
        byProject: { [options.projectId]: cost },
        byMember: pickKeys(full.byMember, events.map((e) => e.memberId)),
        byAgent: pickKeys(full.byAgent, events.map((e) => e.agentId)),
        byProvider: pickKeys(full.byProvider, events.map((e) => e.provider)),
        byModel: full.byModel,
      };
    } else if (options.memberId || (viewer.memberId && viewer.role !== "engineering-manager" && viewer.role !== "system")) {
      const memberId = options.memberId ?? viewer.memberId!;
      const p = resolvePeriod(period);
      const events = this.usageService.getStore().getByMember(memberId, p);
      const cost = events.reduce((s, e) => s + e.estimatedCostUsd, 0);
      summary = {
        ...full,
        totalCostUsd: Math.round(cost * 1_000_000) / 1_000_000,
        totalTokens: events.reduce((s, e) => s + e.totalTokens, 0),
        byProject: pickKeys(full.byProject, events.map((e) => e.projectId)),
        byMember: { [memberId]: cost },
        byAgent: pickKeys(full.byAgent, events.map((e) => e.agentId)),
        byProvider: pickKeys(full.byProvider, events.map((e) => e.provider)),
        byModel: full.byModel,
      };
    } else if (options.agentId) {
      const p = resolvePeriod(period);
      const events = this.usageService.getStore().getByAgent(options.agentId, p);
      const cost = events.reduce((s, e) => s + e.estimatedCostUsd, 0);
      summary = {
        ...full,
        totalCostUsd: Math.round(cost * 1_000_000) / 1_000_000,
        totalTokens: events.reduce((s, e) => s + e.totalTokens, 0),
        byProject: pickKeys(full.byProject, events.map((e) => e.projectId)),
        byMember: pickKeys(full.byMember, events.map((e) => e.memberId)),
        byAgent: { [options.agentId]: cost },
        byProvider: pickKeys(full.byProvider, events.map((e) => e.provider)),
        byModel: full.byModel,
      };
    } else if (options.provider) {
      const p = resolvePeriod(period);
      const events = this.usageService
        .getStore()
        .getByProvider(options.provider, p);
      const cost = events.reduce((s, e) => s + e.estimatedCostUsd, 0);
      summary = {
        ...full,
        totalCostUsd: Math.round(cost * 1_000_000) / 1_000_000,
        totalTokens: events.reduce((s, e) => s + e.totalTokens, 0),
        byProvider: { [options.provider]: cost },
      };
    }

    const text = this.formatter.formatWithBudgets(
      summary,
      this.budgetService,
    );
    return { summary, text };
  }
}

function pickKeys(
  map: Record<string, number>,
  keys: Array<string | undefined>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) {
    if (k && map[k] !== undefined) out[k] = map[k];
  }
  return out;
}
