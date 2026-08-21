import {
  ProjectNotFoundError,
  type ProjectConfigService,
} from "engineering-platform/config";
import { McpProjectNotFoundError } from "../../errors/mcp-errors.js";
import type { ConfluenceService } from "../../integrations/confluence/confluence.service.js";
import type { GitHubService } from "../../integrations/github/github.service.js";
import type { JiraService } from "../../integrations/jira/jira.service.js";
import {
  blockedReason,
  clampPositiveInt,
  countWorkBuckets,
  daysBetween,
  extractIssueKeysFromPr,
  hoursBetween,
  isDoneStatus,
  isExplicitlyBlocked,
  evaluatePrRiskLevel,
  prChangeSize,
  summarizeReviews,
  average,
  maxNumber,
} from "./engineering.mapper.js";
import {
  DEFAULT_ENGINEERING_THRESHOLDS,
  type EngineeringRisk,
  type EngineeringThresholds,
  type RiskSeverity,
  type SourceHealthMap,
  type UnknownSection,
  type WorkCounts,
} from "./engineering.types.js";
import { DeliveryService } from "./delivery/delivery.service.js";
import type { DeliveryPrSnapshot } from "./delivery/delivery.service.js";
import { RiskService } from "./risk/risk.service.js";
import { SprintService } from "./sprint/sprint.service.js";
import type { SprintStatus } from "./sprint/sprint.service.js";
import { TeamService } from "./team/team.service.js";
import type { TeamStatus } from "./team/team.service.js";
import { settleSource } from "./source-health.js";

export interface EngineeringServiceOptions {
  jira: JiraService | null;
  github: GitHubService | null;
  confluence: ConfluenceService | null;
  projectConfigService: ProjectConfigService;
  thresholds?: Partial<EngineeringThresholds>;
  now?: () => Date;
}

export interface ProjectStatus {
  projectId: string;
  sprint:
    | {
        name?: string;
        state?: string;
        startDate?: string;
        endDate?: string;
        goal?: string;
        status?: "unknown";
        reason?: string;
      }
    | null;
  work: WorkCounts | UnknownSection;
  delivery:
    | {
        openPullRequests: number;
        mergedPullRequests?: number;
        averagePullRequestAgeHours?: number;
        oldestOpenPullRequestAgeHours?: number;
      }
    | UnknownSection;
  quality:
    | {
        ciFailureRate?: number;
        failedChecks?: number;
        totalChecks?: number;
      }
    | UnknownSection;
  documentation:
    | {
        pagesFound?: number;
        recentlyUpdatedPages?: number;
      }
    | UnknownSection;
  risks: Array<{
    severity: RiskSeverity;
    type: string;
    title: string;
    description: string;
  }>;
  sources: SourceHealthMap;
}

export interface StaleWorkResult {
  projectId: string;
  staleDays: number;
  issues: Array<{
    key: string;
    summary: string;
    status: string;
    assignee?: string;
    updatedAt?: string;
    ageDays: number;
  }>;
  sources: SourceHealthMap;
}

export interface BlockedWorkResult {
  projectId: string;
  issues: Array<{
    key: string;
    summary: string;
    status: string;
    assignee?: string;
    blockedReason?: string;
    updatedAt?: string;
  }>;
  sources: SourceHealthMap;
}

export interface PrStatusResult {
  projectId: string;
  pullRequests: Array<{
    repository: string;
    number: number;
    title: string;
    author?: string;
    sourceBranch?: string;
    targetBranch?: string;
    state: string;
    draft: boolean;
    ageHours?: number;
    review: { approved: number; changesRequested: number; waiting: boolean };
    ci: { status?: string; conclusion?: string };
  jiraIssues: Array<{ key?: string; linked: boolean }>;
  riskLevel: RiskSeverity;
}>;
  sources: SourceHealthMap;
}

export interface RiskReportResult {
  projectId: string;
  overallRisk: "low" | "medium" | "high" | "critical";
  risks: EngineeringRisk[];
  sources: SourceHealthMap;
}

/**
 * Domain aggregation layer over Jira/GitHub/Confluence services.
 * Deterministic. No HTTP. No LLM.
 */
export class EngineeringService {
  private readonly jira: JiraService | null;
  private readonly github: GitHubService | null;
  private readonly confluence: ConfluenceService | null;
  private readonly projectConfigService: ProjectConfigService;
  private readonly thresholds: EngineeringThresholds;
  private readonly now: () => Date;
  private readonly riskService: RiskService;
  private readonly deliveryService: DeliveryService;
  private readonly sprintService: SprintService;
  private readonly teamService: TeamService;

  constructor(options: EngineeringServiceOptions) {
    this.jira = options.jira;
    this.github = options.github;
    this.confluence = options.confluence;
    this.projectConfigService = options.projectConfigService;
    this.thresholds = { ...DEFAULT_ENGINEERING_THRESHOLDS, ...options.thresholds };
    this.now = options.now ?? (() => new Date());
    this.riskService = new RiskService(this.thresholds);
    this.deliveryService = new DeliveryService({
      jira: this.jira,
      github: this.github,
      projectConfigService: this.projectConfigService,
      thresholds: this.thresholds,
      riskService: this.riskService,
      now: this.now,
    });
    this.sprintService = new SprintService({
      jira: this.jira,
      thresholds: this.thresholds,
      now: this.now,
    });
    this.teamService = new TeamService({
      jira: this.jira,
      github: this.github,
    });
  }

  async getProjectStatus(projectId: string): Promise<ProjectStatus> {
    this.assertProjectExists(projectId);
    const now = this.now();

    const [sprintSettled, workSettled, deliverySettled, docsSettled] = await Promise.all([
      settleSource(Boolean(this.jira?.isConfigured()), "Jira not configured", async () => {
        const result = await this.jira!.searchIssues(projectId, "sprint in openSprints()", 20);
        return result;
      }),
      settleSource(Boolean(this.jira?.isConfigured()), "Jira not configured", async () => {
        const result = await this.jira!.searchIssues(projectId, undefined, 50);
        return result.issues;
      }),
      settleSource(Boolean(this.github?.isConfigured()), "GitHub not configured", async () =>
        this.deliveryService.collectOpenPrSnapshots(projectId, now),
      ),
      settleSource(Boolean(this.confluence?.isConfigured()), "Confluence not configured", async () => {
        const result = await this.confluence!.searchPages(projectId, { limit: 20 });
        return result;
      }),
    ]);

    const sources: SourceHealthMap = {
      jira:
        workSettled.health === "ok" || sprintSettled.health === "ok"
          ? workSettled.health === "unavailable" && sprintSettled.health === "unavailable"
            ? "unavailable"
            : workSettled.health === "ok" || sprintSettled.health === "ok"
              ? "ok"
              : workSettled.health
          : workSettled.health,
      github: deliverySettled.health,
      confluence: docsSettled.health,
    };

    // Refine jira health
    if (
      !this.jira?.isConfigured()
    ) {
      sources.jira = "not_configured";
    } else if (workSettled.health === "unavailable" && sprintSettled.health === "unavailable") {
      sources.jira = "unavailable";
    } else if (workSettled.health === "ok" || sprintSettled.health === "ok") {
      sources.jira = "ok";
    }

    let sprint: ProjectStatus["sprint"] = null;
    if (sprintSettled.health === "ok" && sprintSettled.data) {
      sprint = {
        status: "unknown",
        reason: "Active sprint metadata requires sprintId; open sprint tickets were detected.",
        state: sprintSettled.data.issues.length > 0 ? "active" : "empty",
        name: "openSprints",
      };
    } else if (sprintSettled.health === "not_configured" || sprintSettled.health === "unavailable") {
      sprint = {
        status: "unknown",
        reason: sprintSettled.reason ?? "Jira unavailable",
      };
    }

    const work: ProjectStatus["work"] =
      workSettled.health === "ok" && workSettled.data
        ? countWorkBuckets(workSettled.data)
        : { status: "unknown", reason: workSettled.reason ?? "Jira unavailable" };

    let delivery: ProjectStatus["delivery"];
    let quality: ProjectStatus["quality"];

    if (deliverySettled.health === "ok" && deliverySettled.data) {
      const prs = deliverySettled.data;
      const ages = prs.map((p) => p.ageHours).filter((v): v is number => v !== undefined);
      const avg = average(ages);
      const oldest = maxNumber(ages);
      delivery = {
        openPullRequests: prs.length,
        ...(avg !== undefined ? { averagePullRequestAgeHours: avg } : {}),
        ...(oldest !== undefined ? { oldestOpenPullRequestAgeHours: oldest } : {}),
      };

      let failedChecks = 0;
      let totalChecks = 0;
      for (const pr of prs) {
        if (!pr.checks) continue;
        totalChecks += pr.checks.checks.length || (pr.checks.conclusion ? 1 : 0);
        if (pr.ciFailed) {
          failedChecks += 1;
        }
      }
      quality = {
        ...(totalChecks > 0
          ? { ciFailureRate: Math.round((failedChecks / Math.max(prs.length, 1)) * 1000) / 10 }
          : {}),
        ...(failedChecks > 0 || totalChecks > 0 ? { failedChecks, totalChecks } : {}),
      };
      if (Object.keys(quality).length === 0) {
        quality = { totalChecks: 0, failedChecks: 0 };
      }
    } else {
      delivery = {
        status: "unknown",
        reason: deliverySettled.reason ?? "GitHub unavailable",
      };
      quality = {
        status: "unknown",
        reason: deliverySettled.reason ?? "GitHub unavailable",
      };
    }

    let documentation: ProjectStatus["documentation"];
    if (docsSettled.health === "ok" && docsSettled.data) {
      const pages = docsSettled.data.pages;
      const recent = pages.filter((p) => {
        const age = daysBetween(p.updatedAt, now);
        return age !== undefined && age <= 30;
      }).length;
      documentation = {
        pagesFound: docsSettled.data.total ?? pages.length,
        recentlyUpdatedPages: recent,
      };
    } else {
      documentation = {
        status: "unknown",
        reason: docsSettled.reason ?? "Confluence unavailable",
      };
    }

    const risks = this.collectRisks({
      issues: workSettled.data ?? [],
      prs: deliverySettled.data ?? [],
      now,
    });

    return {
      projectId,
      sprint,
      work,
      delivery,
      quality,
      documentation,
      risks: this.riskService.toCompactRisks(risks),
      sources,
    };
  }

  async getSprintStatus(projectId: string, sprintId?: number): Promise<SprintStatus> {
    this.assertProjectExists(projectId);
    return this.sprintService.getSprintStatus(projectId, sprintId);
  }

  async getTeamStatus(projectId: string): Promise<TeamStatus> {
    this.assertProjectExists(projectId);
    return this.teamService.getTeamStatus(projectId);
  }

  async getDeliveryStatus(projectId: string) {
    this.assertProjectExists(projectId);
    const status = await this.deliveryService.getDeliveryStatus(projectId);
    const { _openPrs: _a, _issues: _b, ...publicStatus } = status;
    return publicStatus;
  }

  async getStaleWork(projectId: string, staleDays?: number): Promise<StaleWorkResult> {
    this.assertProjectExists(projectId);
    const days = staleDays ?? this.thresholds.staleDays;
    clampPositiveInt(days, "staleDays", 365);
    const now = this.now();

    const settled = await settleSource(
      Boolean(this.jira?.isConfigured()),
      "Jira not configured",
      async () => {
        const result = await this.jira!.searchIssues(projectId, undefined, 50);
        return result.issues;
      },
    );

    const sources: SourceHealthMap = {
      jira: settled.health,
      github: "not_configured",
      confluence: "not_configured",
    };

    const issues =
      settled.data
        ?.filter((issue) => !isDoneStatus(issue))
        .map((issue) => {
          const ageDays = daysBetween(issue.updatedAt, now);
          return { issue, ageDays };
        })
        .filter((row) => row.ageDays !== undefined && row.ageDays >= days)
        .map((row) => {
          const item: StaleWorkResult["issues"][number] = {
            key: row.issue.key,
            summary: row.issue.summary,
            status: row.issue.status,
            ageDays: Math.floor(row.ageDays!),
          };
          if (row.issue.assignee) {
            item.assignee = row.issue.assignee;
          }
          if (row.issue.updatedAt) {
            item.updatedAt = row.issue.updatedAt;
          }
          return item;
        }) ?? [];

    return { projectId, staleDays: days, issues, sources };
  }

  async getBlockedWork(projectId: string): Promise<BlockedWorkResult> {
    this.assertProjectExists(projectId);

    const settled = await settleSource(
      Boolean(this.jira?.isConfigured()),
      "Jira not configured",
      async () => {
        const result = await this.jira!.searchIssues(projectId, undefined, 50);
        return result.issues;
      },
    );

    const sources: SourceHealthMap = {
      jira: settled.health,
      github: "not_configured",
      confluence: "not_configured",
    };

    const issues =
      settled.data
        ?.filter((issue) => isExplicitlyBlocked(issue) && !isDoneStatus(issue))
        .map((issue) => {
          const reason = blockedReason(issue);
          const item: BlockedWorkResult["issues"][number] = {
            key: issue.key,
            summary: issue.summary,
            status: issue.status,
          };
          if (issue.assignee) {
            item.assignee = issue.assignee;
          }
          if (reason) {
            item.blockedReason = reason;
          }
          if (issue.updatedAt) {
            item.updatedAt = issue.updatedAt;
          }
          return item;
        }) ?? [];

    return { projectId, issues, sources };
  }

  async getPRStatus(
    projectId: string,
    options: { repository?: string; state?: "open" | "closed" | "all" } = {},
  ): Promise<PrStatusResult> {
    this.assertProjectExists(projectId);
    const now = this.now();
    const state = options.state ?? "open";

    const settled = await settleSource(
      Boolean(this.github?.isConfigured()),
      "GitHub not configured",
      async () => {
        const repos = options.repository
          ? [{ name: options.repository }]
          : (await this.github!.getRepositories(projectId)).repositories;

        // Boundary: if single repo requested, GitHubService will enforce allowlist
        const projectKey = this.safeJiraKey(projectId);
        const snapshots: DeliveryPrSnapshot[] = [];

        for (const repo of repos) {
          const listed = await this.github!.listPullRequests(projectId, repo.name, {
            state,
            perPage: 20,
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

        const enrich = snapshots.slice(0, 15);
        await Promise.all(
          enrich.map(async (snap) => {
            const [detail, reviews, checks] = await Promise.allSettled([
              this.github!.getPullRequest(projectId, snap.repository, snap.summary.number),
              this.github!.listPullRequestReviews(
                projectId,
                snap.repository,
                snap.summary.number,
              ),
              this.github!.getPullRequestChecks(projectId, snap.repository, snap.summary.number),
            ]);
            if (detail.status === "fulfilled") {
              snap.detail = detail.value;
              snap.jiraIssueKeys = extractIssueKeysFromPr(
                {
                  title: detail.value.title,
                  ...(detail.value.sourceBranch !== undefined
                    ? { sourceBranch: detail.value.sourceBranch }
                    : {}),
                  ...(detail.value.body !== undefined ? { body: detail.value.body } : {}),
                },
                projectKey,
              );
            }
            if (reviews.status === "fulfilled") {
              snap.reviews = reviews.value.reviews;
              snap.review = summarizeReviews(snap.reviews);
            }
            if (checks.status === "fulfilled") {
              snap.checks = checks.value;
              const conclusion = (checks.value.conclusion ?? "").toLowerCase();
              snap.ciFailed =
                conclusion === "failure" ||
                checks.value.checks.some((c) => (c.conclusion ?? "").toLowerCase() === "failure");
            }
            const changeSize = snap.detail ? prChangeSize(snap.detail) : undefined;
            snap.riskLevel = evaluatePrRiskLevel({
              ...(snap.ageHours !== undefined ? { ageHours: snap.ageHours } : {}),
              ciFailed: snap.ciFailed,
              changesRequested: snap.review.changesRequested > 0,
              waitingForReview: snap.review.waiting,
              ...(snap.ageHours !== undefined ? { waitingHours: snap.ageHours } : {}),
              ...(changeSize !== undefined ? { changeSize } : {}),
              thresholds: this.thresholds,
            });
          }),
        );

        return snapshots;
      },
    );

    const sources: SourceHealthMap = {
      jira: "not_configured",
      github: settled.health,
      confluence: "not_configured",
    };

    const pullRequests =
      settled.data?.map((snap) => {
        const item: PrStatusResult["pullRequests"][number] = {
          repository: snap.repository,
          number: snap.summary.number,
          title: snap.summary.title,
          state: snap.summary.state,
          draft: snap.summary.draft,
          review: snap.review,
          ci: {
            ...(snap.checks?.status !== undefined ? { status: snap.checks.status } : {}),
            ...(snap.checks?.conclusion !== undefined
              ? { conclusion: snap.checks.conclusion }
              : {}),
          },
          jiraIssues:
            snap.jiraIssueKeys.length > 0
              ? snap.jiraIssueKeys.map((key) => ({ key, linked: true }))
              : [{ linked: false }],
          riskLevel: snap.riskLevel,
        };
        if (snap.summary.author) {
          item.author = snap.summary.author;
        }
        if (snap.summary.sourceBranch) {
          item.sourceBranch = snap.summary.sourceBranch;
        }
        if (snap.summary.targetBranch) {
          item.targetBranch = snap.summary.targetBranch;
        }
        if (snap.ageHours !== undefined) {
          item.ageHours = Math.round(snap.ageHours * 10) / 10;
        }
        return item;
      }) ?? [];

    return { projectId, pullRequests, sources };
  }

  async getRiskReport(projectId: string): Promise<RiskReportResult> {
    this.assertProjectExists(projectId);
    const now = this.now();

    const [issuesSettled, prsSettled] = await Promise.all([
      settleSource(Boolean(this.jira?.isConfigured()), "Jira not configured", async () => {
        const result = await this.jira!.searchIssues(projectId, undefined, 50);
        return result.issues;
      }),
      settleSource(Boolean(this.github?.isConfigured()), "GitHub not configured", async () =>
        this.deliveryService.collectOpenPrSnapshots(projectId, now),
      ),
    ]);

    const sources: SourceHealthMap = {
      jira: issuesSettled.health,
      github: prsSettled.health,
      confluence: this.confluence?.isConfigured() ? "ok" : "not_configured",
    };

    const risks = this.collectRisks({
      issues: issuesSettled.data ?? [],
      prs: prsSettled.data ?? [],
      now,
    });

    return {
      projectId,
      overallRisk: this.riskService.aggregateOverallRisk(risks),
      risks,
      sources,
    };
  }

  private collectRisks(input: {
    issues: Parameters<RiskService["buildBlockedRisks"]>[0];
    prs: DeliveryPrSnapshot[];
    now: Date;
  }): EngineeringRisk[] {
    const blocked = this.riskService.buildBlockedRisks(input.issues);
    const stale = this.riskService.buildStaleRisks(
      input.issues,
      input.now,
      this.thresholds.staleDays,
    );
    const prRisks = this.riskService.buildPrRisks(
      input.prs.map((p) => ({
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
    return [...blocked, ...stale, ...prRisks];
  }

  private assertProjectExists(projectId: string): void {
    try {
      this.projectConfigService.getProject(projectId);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new McpProjectNotFoundError(projectId, { cause: error });
      }
      throw error;
    }
  }

  private safeJiraKey(projectId: string): string | undefined {
    try {
      return this.projectConfigService.getJiraConfig(projectId).projectKey;
    } catch {
      return undefined;
    }
  }
}
