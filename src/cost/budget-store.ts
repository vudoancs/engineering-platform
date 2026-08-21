import type { BudgetLimits, BudgetPolicy, BudgetScope } from "./cost.types.js";

export interface BudgetStore {
  get(scope: BudgetScope, scopeId: string): BudgetPolicy | undefined;
  list(): BudgetPolicy[];
}

/**
 * Resolves budgets from loaded cost-limits config (in-memory).
 */
export class ConfigBudgetStore implements BudgetStore {
  private readonly policies: BudgetPolicy[];

  constructor(policies: BudgetPolicy[]) {
    this.policies = policies;
  }

  get(scope: BudgetScope, scopeId: string): BudgetPolicy | undefined {
    return this.policies.find((p) => p.scope === scope && p.scopeId === scopeId);
  }

  list(): BudgetPolicy[] {
    return this.policies.map((p) => structuredClone(p));
  }
}

export function buildBudgetPolicies(input: {
  warningThresholdPercent: number;
  blockThresholdPercent: number;
  global: BudgetLimits;
  projects: Record<string, BudgetLimits>;
  agents: Record<string, BudgetLimits>;
  members: Record<string, BudgetLimits>;
}): BudgetPolicy[] {
  const { warningThresholdPercent, blockThresholdPercent } = input;
  const policies: BudgetPolicy[] = [
    {
      scope: "GLOBAL",
      scopeId: "global",
      ...input.global,
      warningThresholdPercent,
      blockThresholdPercent,
    },
  ];

  for (const [id, limits] of Object.entries(input.projects)) {
    policies.push({
      scope: "PROJECT",
      scopeId: id,
      ...limits,
      warningThresholdPercent,
      blockThresholdPercent,
    });
  }
  for (const [id, limits] of Object.entries(input.agents)) {
    policies.push({
      scope: "AGENT",
      scopeId: id,
      ...limits,
      warningThresholdPercent,
      blockThresholdPercent,
    });
  }
  for (const [id, limits] of Object.entries(input.members)) {
    policies.push({
      scope: "MEMBER",
      scopeId: id,
      ...limits,
      warningThresholdPercent,
      blockThresholdPercent,
    });
  }
  return policies;
}
