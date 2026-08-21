import type { CostSummary, TimePeriod } from "./cost.types.js";
import type { AIUsageEvent } from "./usage.types.js";
import { usdToMicros, microsToUsd } from "./cost.service.js";

export interface UsageStore {
  record(event: AIUsageEvent): { recorded: boolean; duplicate: boolean };
  getByRequest(requestId: string): AIUsageEvent | undefined;
  getByProject(projectId: string, period: TimePeriod): AIUsageEvent[];
  getByMember(memberId: string, period: TimePeriod): AIUsageEvent[];
  getByAgent(agentId: string, period: TimePeriod): AIUsageEvent[];
  getByProvider(provider: string, period: TimePeriod): AIUsageEvent[];
  getSummary(period: TimePeriod): CostSummary;
  listAll(): AIUsageEvent[];
}

function inPeriod(iso: string, period: TimePeriod): boolean {
  const t = Date.parse(iso);
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);
  return t >= from && t <= to;
}

/**
 * In-memory usage store. Idempotent on requestId.
 */
export class InMemoryUsageStore implements UsageStore {
  private readonly byId = new Map<string, AIUsageEvent>();
  private readonly byRequestId = new Map<string, AIUsageEvent>();

  record(event: AIUsageEvent): { recorded: boolean; duplicate: boolean } {
    const existing = this.byRequestId.get(event.requestId);
    if (existing) {
      return { recorded: false, duplicate: true };
    }
    const clone = structuredClone(event);
    this.byId.set(clone.id, clone);
    this.byRequestId.set(clone.requestId, clone);
    return { recorded: true, duplicate: false };
  }

  getByRequest(requestId: string): AIUsageEvent | undefined {
    const found = this.byRequestId.get(requestId);
    return found ? structuredClone(found) : undefined;
  }

  getByProject(projectId: string, period: TimePeriod): AIUsageEvent[] {
    return this.filter((e) => e.projectId === projectId && inPeriod(e.timestamp, period));
  }

  getByMember(memberId: string, period: TimePeriod): AIUsageEvent[] {
    return this.filter(
      (e) => e.memberId === memberId && inPeriod(e.timestamp, period),
    );
  }

  getByAgent(agentId: string, period: TimePeriod): AIUsageEvent[] {
    return this.filter((e) => e.agentId === agentId && inPeriod(e.timestamp, period));
  }

  getByProvider(provider: string, period: TimePeriod): AIUsageEvent[] {
    return this.filter(
      (e) => e.provider === provider && inPeriod(e.timestamp, period),
    );
  }

  getSummary(period: TimePeriod): CostSummary {
    const events = this.filter((e) => inPeriod(e.timestamp, period));
    let totalMicros = 0;
    let totalTokens = 0;
    const byProjectM = new Map<string, number>();
    const byMemberM = new Map<string, number>();
    const byAgentM = new Map<string, number>();
    const byProviderM = new Map<string, number>();
    const byModelM = new Map<string, number>();

    for (const e of events) {
      const micros = usdToMicros(e.estimatedCostUsd);
      totalMicros += micros;
      totalTokens += e.totalTokens;
      add(byProjectM, e.projectId, micros);
      if (e.memberId) add(byMemberM, e.memberId, micros);
      if (e.agentId) add(byAgentM, e.agentId, micros);
      add(byProviderM, e.provider, micros);
      add(byModelM, `${e.provider}/${e.model}`, micros);
    }

    return {
      period: structuredClone(period),
      totalCostUsd: microsToUsd(totalMicros),
      totalTokens,
      byProject: mapToUsd(byProjectM),
      byMember: mapToUsd(byMemberM),
      byAgent: mapToUsd(byAgentM),
      byProvider: mapToUsd(byProviderM),
      byModel: mapToUsd(byModelM),
    };
  }

  listAll(): AIUsageEvent[] {
    return [...this.byId.values()].map((e) => structuredClone(e));
  }

  private filter(pred: (e: AIUsageEvent) => boolean): AIUsageEvent[] {
    return [...this.byId.values()].filter(pred).map((e) => structuredClone(e));
  }
}

function add(map: Map<string, number>, key: string, micros: number): void {
  map.set(key, (map.get(key) ?? 0) + micros);
}

function mapToUsd(map: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of map) {
    out[k] = microsToUsd(v);
  }
  return out;
}
