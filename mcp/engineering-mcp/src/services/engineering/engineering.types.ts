/**
 * Shared Engineering Intelligence types.
 */

export type SourceHealth = "ok" | "degraded" | "unavailable" | "not_configured";

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export type RiskCategory =
  | "DELIVERY"
  | "WORKLOAD"
  | "PR"
  | "CI"
  | "BLOCKED"
  | "STALE"
  | "DOCUMENTATION";

export type OverallRisk = "low" | "medium" | "high" | "critical";

export interface SourceHealthMap {
  jira: SourceHealth;
  github: SourceHealth;
  confluence: SourceHealth;
}

export interface EngineeringThresholds {
  staleDays: number;
  prStaleHours: number;
  prHighRiskHours: number;
  prLargeChanges: number;
  prReviewWaitingHours: number;
}

export const DEFAULT_ENGINEERING_THRESHOLDS: EngineeringThresholds = {
  staleDays: 7,
  prStaleHours: 48,
  prHighRiskHours: 72,
  prLargeChanges: 500,
  prReviewWaitingHours: 24,
};

export interface WorkCounts {
  total: number;
  todo: number;
  inProgress: number;
  done: number;
  blocked: number;
}

export interface UnknownSection {
  status: "unknown";
  reason: string;
}

export interface RiskEvidence {
  source: "jira" | "github" | "confluence" | "engineering";
  reference?: string;
  repository?: string;
  pullRequestNumber?: number;
  issueKey?: string;
  pageId?: string;
}

export interface EngineeringRisk {
  severity: RiskSeverity;
  category: RiskCategory;
  type: string;
  title: string;
  description: string;
  reason: string;
  source: {
    type: "jira" | "github" | "confluence" | "engineering";
    reference: string;
  };
  evidence: RiskEvidence[];
  issueKey?: string;
  pullRequestNumber?: string | number;
}

export interface SettledSourceResult<T> {
  health: SourceHealth;
  data?: T;
  reason?: string;
}
