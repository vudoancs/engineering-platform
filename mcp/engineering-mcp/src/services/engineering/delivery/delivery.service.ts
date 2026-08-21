import type { GitHubService } from "../../../integrations/github/github.service.js";
import type {
  CompactChecksResult,
  CompactPullRequestDetail,
  CompactPullRequestSummary,
  CompactReview,
} from "../../../integrations/github/github.types.js";
import type { JiraService } from "../../../integrations/jira/jira.service.js";
import type { CompactIssueSummary } from "../../../integrations/jira/jira.types.js";
import type { ProjectConfigService } from "engineering-platform/config";
import {
  average,
  extractIssueKeysFromPr,
  hoursBetween,
  maxNumber,
  prChangeSize,
  evaluatePrRiskLevel,
  summarizeReviews,
  countWorkBuckets,
} from "../engineering.mapper.js";
import type {
  EngineeringRisk,
  EngineeringThresholds,
  SourceHealthMap,
  UnknownSection,
  WorkCounts,
} from "../engineering.types.js";
import { RiskService } from "../risk/risk.service.js";
import { settleSource } from "../source-health.js";

export interface DeliveryPrSnapshot {
  repository: string;
  summary: CompactPullRequestSummary;
  detail?: CompactPullRequestDetail;
  reviews: CompactReview[];
  checks?: CompactChecksResult;
  ageHours?: number;
  jiraIssueKeys: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  review: { approved: number; changesRequested: number; waiting: boolean };
  ciFailed: boolean;
  changeSize?: number;
}

export interface DeliveryStatus {
  projectId: string;
  work: WorkCounts | UnknownSection;
  pullRequests:
    | {
        open: number;
        merged: number;
        waitingForReview: number;
        stale: number;
        failedCI: number;
      }
    | UnknownSection;
  cycleTime:
    | {
        averagePRAgeHours?: number;
        oldestOpenPRHours?: number;
      }
    | UnknownSection;
  deliveryRisks: Array<{
    severity: string;
    type: string;
    title: string;
    description: string;
    issueKey?: string;
    pullRequestNumber?: number;
  }>;
  sources: SourceHealthMap;
  /** Internal snapshots for other aggregations (not exposed raw). */
  _openPrs?: DeliveryPrSnapshot[];
  _issues?: CompactIssueSummary[];
}

export interface DeliveryServiceOptions {
  jira: JiraService | null;
  github: GitHubService | null;
  projectConfigService: ProjectConfigService;
  thresholds: EngineeringThresholds;
  riskService: RiskService;
  now?: () => Date;
  maxPrsPerRepo?: number;
  enrichPrLimit?: number;
}

/**
 * Aggregates Jira work + GitHub delivery signals.
 */
export class DeliveryService {
  private readonly jira: JiraService | null;
  private readonly github: GitHubService | null;
  private readonly projectConfigService: ProjectConfigService;
  private readonly thresholds: EngineeringThresholds;
  private readonly riskService: RiskService;
  private readonly now: () => Date;
  private readonly maxPrsPerRepo: number;
  private readonly enrichPrLimit: number;

  constructor(options: DeliveryServiceOptions) {
    this.jira = options.jira;
    this.github = options.github;
    this.projectConfigService = options.projectConfigService;
    this.thresholds = options.thresholds;
    this.riskService = options.riskService;
    this.now = options.now ?? (() => new Date());
    this.maxPrsPerRepo = options.maxPrsPerRepo ?? 20;
    this.enrichPrLimit = options.enrichPrLimit ?? 15;
  }

  async getDeliveryStatus(projectId: string): Promise<DeliveryStatus> {
    const now = this.now();
    const [jiraSettled, githubSettled] = await Promise.all([
      settleSource(Boolean(this.jira?.isConfigured()), "Jira not configured", async () => {
        const result = await this.jira!.searchIssues(projectId, undefined, 50);
        return result.issues;
      }),
      settleSource(Boolean(this.github?.isConfigured()), "GitHub not configured", async () =>
        this.collectOpenPrSnapshots(projectId, now),
      ),
    ]);

    const sources: SourceHealthMap = {
      jira: jiraSettled.health,
      github: githubSettled.health,
      confluence: "not_configured",
    };

    const work: WorkCounts | UnknownSection =
      jiraSettled.health === "ok" && jiraSettled.data
        ? countWorkBuckets(jiraSettled.data)
        : {
            status: "unknown",
            reason: jiraSettled.reason ?? "Jira unavailable",
          };

    let pullRequests: DeliveryStatus["pullRequests"];
    let cycleTime: DeliveryStatus["cycleTime"];
    const deliveryRisks: DeliveryStatus["deliveryRisks"] = [];
    const openPrs = githubSettled.data ?? [];

    if (githubSettled.health === "ok") {
      const ages = openPrs
        .map((p) => p.ageHours)
        .filter((v): v is number => v !== undefined);
      pullRequests = {
        open: openPrs.length,
        merged: 0, // filled below if we also listed recently merged
        waitingForReview: openPrs.filter((p) => p.review.waiting).length,
        stale: openPrs.filter(
          (p) => p.ageHours !== undefined && p.ageHours > this.thresholds.prStaleHours,
        ).length,
        failedCI: openPrs.filter((p) => p.ciFailed).length,
      };

      const mergedCount = await this.countMergedPrs(projectId);
      if (mergedCount !== undefined && typeof pullRequests === "object" && !("status" in pullRequests)) {
        pullRequests.merged = mergedCount;
      }

      const avg = average(ages);
      const oldest = maxNumber(ages);
      cycleTime = {
        ...(avg !== undefined ? { averagePRAgeHours: avg } : {}),
        ...(oldest !== undefined ? { oldestOpenPRHours: oldest } : {}),
      };

      const prRisks = this.riskService.buildPrRisks(
        openPrs.map((p) => ({
          repository: p.repository,
          number: p.summary.number,
          title: p.summary.title,
          ...(p.ageHours !== undefined ? { ageHours: p.ageHours } : {}),
          ...(p.ageHours !== undefined ? { waitingHours: p.ageHours } : {}),
          ciFailed: p.ciFailed,
          changesRequested: p.review.changesRequested > 0,
          waitingForReview: p.review.waiting,
          ...(p.changeSize !== undefined ? { changeSize: p.changeSize } : {}),
        })),
      );

      const jiraRisks =
        jiraSettled.data !== undefined
          ? [
              ...this.riskService.buildBlockedRisks(jiraSettled.data),
              ...this.riskService.buildStaleRisks(
                jiraSettled.data,
                now,
                this.thresholds.staleDays,
              ),
            ]
          : [];

      for (const risk of [...prRisks, ...jiraRisks]) {
        deliveryRisks.push(toDeliveryRisk(risk));
      }
    } else {
      pullRequests = {
        status: "unknown",
        reason: githubSettled.reason ?? "GitHub unavailable",
      };
      cycleTime = {
        status: "unknown",
        reason: githubSettled.reason ?? "GitHub unavailable",
      };
      if (jiraSettled.data) {
        for (const risk of [
          ...this.riskService.buildBlockedRisks(jiraSettled.data),
          ...this.riskService.buildStaleRisks(jiraSettled.data, now, this.thresholds.staleDays),
        ]) {
          deliveryRisks.push(toDeliveryRisk(risk));
        }
      }
    }

    return {
      projectId,
      work,
      pullRequests,
      cycleTime,
      deliveryRisks,
      sources: {
        ...sources,
        confluence: "not_configured",
      },
      ...(openPrs.length > 0 ? { _openPrs: openPrs } : {}),
      ...(jiraSettled.data ? { _issues: jiraSettled.data } : {}),
    };
  }

  async collectOpenPrSnapshots(projectId: string, now: Date): Promise<DeliveryPrSnapshot[]> {
    if (!this.github?.isConfigured()) {
      return [];
    }

    const repos = await this.github.getRepositories(projectId);
    const projectKey = this.safeProjectKey(projectId);
    const snapshots: DeliveryPrSnapshot[] = [];

    for (const repo of repos.repositories) {
      const listed = await this.github.listPullRequests(projectId, repo.name, {
        state: "open",
        perPage: this.maxPrsPerRepo,
      });

      for (const summary of listed.pullRequests) {
        const ageHours = hoursBetween(summary.createdAt, now);
        snapshots.push({
          repository: repo.name,
          summary,
          reviews: [],
          ...(ageHours !== undefined ? { ageHours } : {}),
          jiraIssueKeys: extractIssueKeysFromPr(summary, projectKey),
          riskLevel: "low",
          review: { approved: 0, changesRequested: 0, waiting: true },
          ciFailed: false,
        });
      }
    }

    const toEnrich = snapshots.slice(0, this.enrichPrLimit);
    await Promise.all(
      toEnrich.map(async (snap) => {
        const [detailSettled, reviewsSettled, checksSettled] = await Promise.allSettled([
          this.github!.getPullRequest(projectId, snap.repository, snap.summary.number),
          this.github!.listPullRequestReviews(projectId, snap.repository, snap.summary.number),
          this.github!.getPullRequestChecks(projectId, snap.repository, snap.summary.number),
        ]);

        if (detailSettled.status === "fulfilled") {
          snap.detail = detailSettled.value;
          const size = prChangeSize(detailSettled.value);
          if (size !== undefined) {
            snap.changeSize = size;
          }
          snap.jiraIssueKeys = extractIssueKeysFromPr(
            {
              title: detailSettled.value.title,
              ...(detailSettled.value.sourceBranch !== undefined
                ? { sourceBranch: detailSettled.value.sourceBranch }
                : {}),
              ...(detailSettled.value.body !== undefined
                ? { body: detailSettled.value.body }
                : {}),
            },
            projectKey,
          );
        }
        if (reviewsSettled.status === "fulfilled") {
          snap.reviews = reviewsSettled.value.reviews;
          snap.review = summarizeReviews(snap.reviews);
        }
        if (checksSettled.status === "fulfilled") {
          snap.checks = checksSettled.value;
          snap.ciFailed = isCiFailed(checksSettled.value);
        }

        snap.riskLevel = evaluatePrRiskLevel({
          ...(snap.ageHours !== undefined ? { ageHours: snap.ageHours } : {}),
          ciFailed: snap.ciFailed,
          changesRequested: snap.review.changesRequested > 0,
          waitingForReview: snap.review.waiting,
          ...(snap.ageHours !== undefined ? { waitingHours: snap.ageHours } : {}),
          ...(snap.changeSize !== undefined ? { changeSize: snap.changeSize } : {}),
          thresholds: this.thresholds,
        });
      }),
    );

    return snapshots;
  }

  private async countMergedPrs(projectId: string): Promise<number | undefined> {
    if (!this.github?.isConfigured()) {
      return undefined;
    }
    try {
      const repos = await this.github.getRepositories(projectId);
      let merged = 0;
      for (const repo of repos.repositories) {
        const closed = await this.github.listPullRequests(projectId, repo.name, {
          state: "closed",
          perPage: 20,
        });
        merged += closed.pullRequests.filter((pr) => Boolean(pr.mergedAt)).length;
      }
      return merged;
    } catch {
      return undefined;
    }
  }

  private safeProjectKey(projectId: string): string | undefined {
    try {
      return this.projectConfigService.getJiraConfig(projectId).projectKey;
    } catch {
      return undefined;
    }
  }
}

function isCiFailed(checks: CompactChecksResult): boolean {
  const conclusion = (checks.conclusion ?? "").toLowerCase();
  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "cancelled") {
    return true;
  }
  return checks.checks.some((c) => {
    const cConc = (c.conclusion ?? "").toLowerCase();
    return cConc === "failure" || cConc === "timed_out";
  });
}

function toDeliveryRisk(risk: EngineeringRisk): {
  severity: string;
  type: string;
  title: string;
  description: string;
  issueKey?: string;
  pullRequestNumber?: number;
} {
  const item: {
    severity: string;
    type: string;
    title: string;
    description: string;
    issueKey?: string;
    pullRequestNumber?: number;
  } = {
    severity: risk.severity,
    type: risk.type,
    title: risk.title,
    description: risk.description,
  };
  if (risk.issueKey) {
    item.issueKey = risk.issueKey;
  }
  if (typeof risk.pullRequestNumber === "number") {
    item.pullRequestNumber = risk.pullRequestNumber;
  }
  return item;
}
