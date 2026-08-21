import type {
  EngineeringRisk,
  EngineeringThresholds,
  OverallRisk,
  RiskSeverity,
  SourceHealthMap,
} from "../engineering.types.js";
import type { CompactIssueSummary } from "../../../integrations/jira/jira.types.js";
import {
  blockedReason,
  daysBetween,
  isDoneStatus,
  isExplicitlyBlocked,
} from "../engineering.mapper.js";

export interface PrRiskInput {
  repository: string;
  number: number;
  title: string;
  ageHours?: number;
  waitingHours?: number;
  ciFailed: boolean;
  changesRequested: boolean;
  waitingForReview: boolean;
  changeSize?: number;
}

export interface RiskReport {
  projectId: string;
  overallRisk: OverallRisk;
  risks: EngineeringRisk[];
  sources: SourceHealthMap;
}

/**
 * Deterministic risk engine. Explainable rules only — no LLM.
 */
export class RiskService {
  constructor(private readonly thresholds: EngineeringThresholds) {}

  buildBlockedRisks(issues: CompactIssueSummary[]): EngineeringRisk[] {
    const risks: EngineeringRisk[] = [];
    for (const issue of issues) {
      if (!isExplicitlyBlocked(issue) || isDoneStatus(issue)) {
        continue;
      }
      const reason = blockedReason(issue) ?? "Explicit blocked signal";
      risks.push({
        severity: "high",
        category: "BLOCKED",
        type: "BLOCKED_TICKET",
        title: `Blocked issue ${issue.key}`,
        description: `${issue.key} is blocked (${reason}).`,
        reason,
        source: { type: "jira", reference: issue.key },
        evidence: [{ source: "jira", issueKey: issue.key, reference: issue.key }],
        issueKey: issue.key,
      });
    }
    return risks;
  }

  buildStaleRisks(issues: CompactIssueSummary[], now: Date, staleDays: number): EngineeringRisk[] {
    const risks: EngineeringRisk[] = [];
    for (const issue of issues) {
      if (isDoneStatus(issue)) {
        continue;
      }
      const ageDays = daysBetween(issue.updatedAt, now);
      if (ageDays === undefined || ageDays < staleDays) {
        continue;
      }
      risks.push({
        severity: "medium",
        category: "STALE",
        type: "STALE_TICKET",
        title: `Stale issue ${issue.key}`,
        description: `${issue.key} has not been updated for ${Math.floor(ageDays)} days.`,
        reason: `updatedAt older than ${staleDays} days`,
        source: { type: "jira", reference: issue.key },
        evidence: [
          {
            source: "jira",
            issueKey: issue.key,
            reference: issue.updatedAt ?? issue.key,
          },
        ],
        issueKey: issue.key,
      });
    }
    return risks;
  }

  buildPrRisks(prs: PrRiskInput[]): EngineeringRisk[] {
    const risks: EngineeringRisk[] = [];
    for (const pr of prs) {
      const ref = `${pr.repository}#${pr.number}`;

      if (pr.ciFailed) {
        risks.push({
          severity: "high",
          category: "CI",
          type: "PR_CI_FAILED",
          title: `CI failed on PR #${pr.number}`,
          description: `Pull request ${ref} has failing checks.`,
          reason: "CI conclusion is failure",
          source: { type: "github", reference: ref },
          evidence: [
            {
              source: "github",
              repository: pr.repository,
              pullRequestNumber: pr.number,
              reference: ref,
            },
          ],
          pullRequestNumber: pr.number,
        });
      }

      if (pr.changesRequested) {
        risks.push({
          severity: "high",
          category: "PR",
          type: "PR_CHANGES_REQUESTED",
          title: `Changes requested on PR #${pr.number}`,
          description: `Pull request ${ref} has changes requested.`,
          reason: "Review state CHANGES_REQUESTED",
          source: { type: "github", reference: ref },
          evidence: [
            {
              source: "github",
              repository: pr.repository,
              pullRequestNumber: pr.number,
              reference: ref,
            },
          ],
          pullRequestNumber: pr.number,
        });
      }

      if (pr.ageHours !== undefined && pr.ageHours > this.thresholds.prHighRiskHours) {
        risks.push({
          severity: "high",
          category: "PR",
          type: "PR_HIGH_AGE",
          title: `PR #${pr.number} older than ${this.thresholds.prHighRiskHours}h`,
          description: `Pull request ${ref} is ${Math.floor(pr.ageHours)} hours old.`,
          reason: `ageHours > ${this.thresholds.prHighRiskHours}`,
          source: { type: "github", reference: ref },
          evidence: [
            {
              source: "github",
              repository: pr.repository,
              pullRequestNumber: pr.number,
              reference: ref,
            },
          ],
          pullRequestNumber: pr.number,
        });
      } else if (pr.ageHours !== undefined && pr.ageHours > this.thresholds.prStaleHours) {
        risks.push({
          severity: "medium",
          category: "PR",
          type: "PR_STALE",
          title: `Stale PR #${pr.number}`,
          description: `Pull request ${ref} is ${Math.floor(pr.ageHours)} hours old.`,
          reason: `ageHours > ${this.thresholds.prStaleHours}`,
          source: { type: "github", reference: ref },
          evidence: [
            {
              source: "github",
              repository: pr.repository,
              pullRequestNumber: pr.number,
              reference: ref,
            },
          ],
          pullRequestNumber: pr.number,
        });
      }

      if (
        pr.waitingForReview &&
        pr.waitingHours !== undefined &&
        pr.waitingHours > this.thresholds.prReviewWaitingHours
      ) {
        risks.push({
          severity: "medium",
          category: "PR",
          type: "PR_REVIEW_OVERDUE",
          title: `PR #${pr.number} waiting for review`,
          description: `Pull request ${ref} has been waiting for review for ${Math.floor(pr.waitingHours)} hours.`,
          reason: `waitingHours > ${this.thresholds.prReviewWaitingHours}`,
          source: { type: "github", reference: ref },
          evidence: [
            {
              source: "github",
              repository: pr.repository,
              pullRequestNumber: pr.number,
              reference: ref,
            },
          ],
          pullRequestNumber: pr.number,
        });
      }

      if (pr.changeSize !== undefined && pr.changeSize > this.thresholds.prLargeChanges) {
        const severity: RiskSeverity =
          pr.changeSize > this.thresholds.prLargeChanges * 2 ? "medium" : "low";
        risks.push({
          severity,
          category: "PR",
          type: "LARGE_PR",
          title: `Large PR #${pr.number}`,
          description: `Pull request ${ref} has ${pr.changeSize} line changes.`,
          reason: `changeSize > ${this.thresholds.prLargeChanges}`,
          source: { type: "github", reference: ref },
          evidence: [
            {
              source: "github",
              repository: pr.repository,
              pullRequestNumber: pr.number,
              reference: ref,
            },
          ],
          pullRequestNumber: pr.number,
        });
      }
    }
    return risks;
  }

  aggregateOverallRisk(risks: EngineeringRisk[]): OverallRisk {
    const critical = risks.filter((r) => r.severity === "critical").length;
    const high = risks.filter((r) => r.severity === "high").length;
    const medium = risks.filter((r) => r.severity === "medium").length;

    if (critical > 0 || high >= 3) {
      return "critical";
    }
    if (high >= 1) {
      return "high";
    }
    if (medium >= 2) {
      return "medium";
    }
    if (medium >= 1) {
      return "medium";
    }
    return "low";
  }

  toCompactRisks(risks: EngineeringRisk[]): Array<{
    severity: RiskSeverity;
    type: string;
    title: string;
    description: string;
  }> {
    return risks.map((r) => ({
      severity: r.severity,
      type: r.type,
      title: r.title,
      description: r.description,
    }));
  }
}
