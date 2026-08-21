import type { JiraService } from "../../../integrations/jira/jira.service.js";
import type { CompactIssueSummary, CompactSprintIssue } from "../../../integrations/jira/jira.types.js";
import {
  blockedReason,
  classifySprintIssueBucket,
  countSprintWorkBuckets,
  countWorkBuckets,
  daysBetween,
  isDoneStatus,
  isExplicitlyBlocked,
  progressPercentages,
} from "../engineering.mapper.js";
import type { EngineeringThresholds, SourceHealthMap, UnknownSection, WorkCounts } from "../engineering.types.js";
import { EngineeringValidationError } from "../engineering.errors.js";
import { settleSource } from "../source-health.js";

export interface SprintTicketRef {
  key: string;
  summary: string;
  status: string;
  assignee?: string;
  updatedAt?: string;
  ageDays?: number;
  blockedReason?: string;
  dueDate?: string;
}

export interface SprintStatus {
  projectId: string;
  sprint:
    | {
        id?: number;
        name?: string;
        state?: string;
        startDate?: string;
        endDate?: string;
        goal?: string;
        status?: "unknown";
        reason?: string;
      }
    | null;
  tickets: WorkCounts | UnknownSection;
  progress: {
    completedPercentage: number;
    remainingPercentage: number;
  };
  overdueTickets: SprintTicketRef[];
  staleTickets: SprintTicketRef[];
  blockedTickets: SprintTicketRef[];
  sources: SourceHealthMap;
}

export interface SprintServiceOptions {
  jira: JiraService | null;
  thresholds: EngineeringThresholds;
  now?: () => Date;
}

export class SprintService {
  private readonly jira: JiraService | null;
  private readonly thresholds: EngineeringThresholds;
  private readonly now: () => Date;

  constructor(options: SprintServiceOptions) {
    this.jira = options.jira;
    this.thresholds = options.thresholds;
    this.now = options.now ?? (() => new Date());
  }

  async getSprintStatus(projectId: string, sprintId?: number): Promise<SprintStatus> {
    if (sprintId !== undefined) {
      if (!Number.isInteger(sprintId) || sprintId <= 0) {
        throw new EngineeringValidationError("sprintId must be a positive integer");
      }
      return this.fromSprintId(projectId, sprintId);
    }
    return this.fromOpenSprints(projectId);
  }

  private async fromSprintId(projectId: string, sprintId: number): Promise<SprintStatus> {
    const settled = await settleSource(
      Boolean(this.jira?.isConfigured()),
      "Jira not configured",
      () => this.jira!.getSprint(projectId, sprintId),
    );

    const sources: SourceHealthMap = {
      jira: settled.health,
      github: "not_configured",
      confluence: "not_configured",
    };

    if (settled.health !== "ok" || !settled.data) {
      return {
        projectId,
        sprint: null,
        tickets: { status: "unknown", reason: settled.reason ?? "Jira unavailable" },
        progress: { completedPercentage: 0, remainingPercentage: 0 },
        overdueTickets: [],
        staleTickets: [],
        blockedTickets: [],
        sources,
      };
    }

    const sprint = settled.data;
    const tickets = countSprintWorkBuckets(sprint.issues);
    const progress = progressPercentages(tickets.done, tickets.total);

    const blockedTickets = sprint.issues
      .filter((i) => classifySprintIssueBucket(i) === "blocked")
      .map((i) => toSprintRefFromSprintIssue(i));

    // Sprint issues lack updatedAt/dueDate — stale/overdue require search enrichment when possible
    const enriched = await this.enrichSprintIssues(projectId, sprint.issues);

    return {
      projectId,
      sprint: {
        id: sprint.id,
        name: sprint.name,
        ...(sprint.state !== undefined ? { state: sprint.state } : {}),
        ...(sprint.startDate !== undefined ? { startDate: sprint.startDate } : {}),
        ...(sprint.endDate !== undefined ? { endDate: sprint.endDate } : {}),
        ...(sprint.goal !== undefined ? { goal: sprint.goal } : {}),
      },
      tickets,
      progress,
      overdueTickets: enriched.overdue,
      staleTickets: enriched.stale,
      blockedTickets:
        blockedTickets.length > 0
          ? blockedTickets
          : enriched.blocked,
      sources,
    };
  }

  private async fromOpenSprints(projectId: string): Promise<SprintStatus> {
    const settled = await settleSource(
      Boolean(this.jira?.isConfigured()),
      "Jira not configured",
      () => this.jira!.searchIssues(projectId, "sprint in openSprints()", 50),
    );

    const sources: SourceHealthMap = {
      jira: settled.health,
      github: "not_configured",
      confluence: "not_configured",
    };

    if (settled.health !== "ok" || !settled.data) {
      return {
        projectId,
        sprint: {
          status: "unknown",
          reason: settled.reason ?? "Jira unavailable",
        },
        tickets: { status: "unknown", reason: settled.reason ?? "Jira unavailable" },
        progress: { completedPercentage: 0, remainingPercentage: 0 },
        overdueTickets: [],
        staleTickets: [],
        blockedTickets: [],
        sources,
      };
    }

    const issues = settled.data.issues;
    const tickets = countWorkBuckets(issues);
    const progress = progressPercentages(tickets.done, tickets.total);
    const now = this.now();

    return {
      projectId,
      sprint: {
        status: "unknown",
        reason:
          "sprintId not provided; tickets loaded via openSprints JQL. Pass sprintId for full sprint metadata.",
        state: "active",
        name: "openSprints",
      },
      tickets,
      progress,
      overdueTickets: issues
        .filter((i) => isOverdue(i, now))
        .map((i) => toSprintRefFromIssue(i, now)),
      staleTickets: issues
        .filter((i) => isStaleIssue(i, now, this.thresholds.staleDays))
        .map((i) => toSprintRefFromIssue(i, now)),
      blockedTickets: issues
        .filter((i) => isExplicitlyBlocked(i) && !isDoneStatus(i))
        .map((i) => toSprintRefFromIssue(i, now)),
      sources,
    };
  }

  private async enrichSprintIssues(
    projectId: string,
    sprintIssues: CompactSprintIssue[],
  ): Promise<{ overdue: SprintTicketRef[]; stale: SprintTicketRef[]; blocked: SprintTicketRef[] }> {
    if (!this.jira?.isConfigured() || sprintIssues.length === 0) {
      return { overdue: [], stale: [], blocked: [] };
    }

    try {
      const keys = sprintIssues.map((i) => i.key);
      // Bound JQL size
      const sample = keys.slice(0, 40);
      const jql = `key in (${sample.map((k) => `"${k}"`).join(",")})`;
      const result = await this.jira.searchIssues(projectId, jql, sample.length);
      const now = this.now();
      return {
        overdue: result.issues.filter((i) => isOverdue(i, now)).map((i) => toSprintRefFromIssue(i, now)),
        stale: result.issues
          .filter((i) => isStaleIssue(i, now, this.thresholds.staleDays))
          .map((i) => toSprintRefFromIssue(i, now)),
        blocked: result.issues
          .filter((i) => isExplicitlyBlocked(i) && !isDoneStatus(i))
          .map((i) => toSprintRefFromIssue(i, now)),
      };
    } catch {
      return { overdue: [], stale: [], blocked: [] };
    }
  }
}

function isOverdue(issue: CompactIssueSummary, now: Date): boolean {
  if (isDoneStatus(issue) || !issue.dueDate) {
    return false;
  }
  const due = Date.parse(issue.dueDate);
  return !Number.isNaN(due) && due < now.getTime();
}

function isStaleIssue(issue: CompactIssueSummary, now: Date, staleDays: number): boolean {
  if (isDoneStatus(issue)) {
    return false;
  }
  const age = daysBetween(issue.updatedAt, now);
  return age !== undefined && age >= staleDays;
}

function toSprintRefFromIssue(issue: CompactIssueSummary, now: Date): SprintTicketRef {
  const ageDays = daysBetween(issue.updatedAt, now);
  const reason = blockedReason(issue);
  const ref: SprintTicketRef = {
    key: issue.key,
    summary: issue.summary,
    status: issue.status,
  };
  if (issue.assignee) {
    ref.assignee = issue.assignee;
  }
  if (issue.updatedAt) {
    ref.updatedAt = issue.updatedAt;
  }
  if (ageDays !== undefined) {
    ref.ageDays = Math.floor(ageDays);
  }
  if (reason) {
    ref.blockedReason = reason;
  }
  if (issue.dueDate) {
    ref.dueDate = issue.dueDate;
  }
  return ref;
}

function toSprintRefFromSprintIssue(issue: CompactSprintIssue): SprintTicketRef {
  const ref: SprintTicketRef = {
    key: issue.key,
    summary: issue.summary,
    status: issue.status,
  };
  if (issue.assignee) {
    ref.assignee = issue.assignee;
  }
  if (classifySprintIssueBucket(issue) === "blocked") {
    ref.blockedReason = `Status is "${issue.status}"`;
  }
  return ref;
}
