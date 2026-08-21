/**
 * Cost / budget domain types.
 */

export type BudgetScope = "GLOBAL" | "PROJECT" | "MEMBER" | "AGENT";

export type CostDecisionType = "ALLOW" | "WARNING" | "BLOCK";

export type PeriodPreset = "day" | "week" | "month";

export interface TimePeriod {
  from: string; // ISO
  to: string; // ISO
}

export interface BudgetLimits {
  dailyLimitUsd?: number;
  weeklyLimitUsd?: number;
  monthlyLimitUsd?: number;
}

export interface BudgetPolicy extends BudgetLimits {
  scope: BudgetScope;
  scopeId: string;
  warningThresholdPercent: number;
  blockThresholdPercent: number;
}

export interface CostBreakdown {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
}

export interface CostDecision {
  decision: CostDecisionType;
  estimatedCostUsd: number;
  currentUsageUsd: number;
  remainingBudgetUsd: number;
  reason: string;
  /** Which scope triggered WARNING/BLOCK (if any). */
  bindingScope?: BudgetScope;
  bindingScopeId?: string;
  usagePercent?: number;
}

export interface CostCheckRequest {
  requestId: string;
  projectId?: string;
  /** Explicit global/system op without project — rare. */
  globalSystemOperation?: boolean;
  memberId?: string;
  agentId?: string;
  provider: string;
  model: string;
  /** Conservative estimate before provider call. */
  estimatedCostUsd: number;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
}

export interface CostLimitsConfig {
  usageRetentionDays: number;
  warningThresholdPercent: number;
  blockThresholdPercent: number;
  global: BudgetLimits;
  projects: Record<string, BudgetLimits>;
  agents: Record<string, BudgetLimits>;
  members: Record<string, BudgetLimits>;
}

export type CostViewerRole = "engineering-manager" | "developer" | "reviewer" | "system";

export interface CostViewer {
  role: CostViewerRole;
  memberId?: string;
}

export interface CostSummary {
  period: TimePeriod;
  totalCostUsd: number;
  totalTokens: number;
  byProject: Record<string, number>;
  byMember: Record<string, number>;
  byAgent: Record<string, number>;
  byProvider: Record<string, number>;
  byModel: Record<string, number>;
}

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

export interface ProviderPricingConfig {
  providers: Record<string, { models: Record<string, ModelPricing> }>;
}
