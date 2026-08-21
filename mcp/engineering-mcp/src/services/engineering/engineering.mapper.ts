/**
 * Pure helpers for Engineering Intelligence (classification, ages, correlation keys).
 * No HTTP. No LLM.
 */

import type { CompactIssueSummary, CompactSprintIssue } from "../../integrations/jira/jira.types.js";
import type { CompactPullRequestDetail, CompactPullRequestSummary, CompactReview } from "../../integrations/github/github.types.js";
import type { RiskSeverity, WorkCounts } from "./engineering.types.js";
import { EngineeringValidationError } from "./engineering.errors.js";

const ISSUE_KEY_PATTERN = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

export type WorkBucket = "todo" | "inProgress" | "done" | "blocked";

export function hoursBetween(fromIso: string | undefined, now: Date): number | undefined {
  if (!fromIso) {
    return undefined;
  }
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) {
    return undefined;
  }
  return Math.max(0, (now.getTime() - from) / (1000 * 60 * 60));
}

export function daysBetween(fromIso: string | undefined, now: Date): number | undefined {
  const hours = hoursBetween(fromIso, now);
  if (hours === undefined) {
    return undefined;
  }
  return hours / 24;
}

export function classifyIssueBucket(
  issue: Pick<CompactIssueSummary, "status" | "statusCategory" | "labels" | "summary">,
): WorkBucket {
  if (isExplicitlyBlocked(issue)) {
    return "blocked";
  }
  if (isDoneStatus(issue)) {
    return "done";
  }
  if (isInProgressStatus(issue)) {
    return "inProgress";
  }
  return "todo";
}

export function classifySprintIssueBucket(
  issue: CompactSprintIssue,
): WorkBucket {
  return classifyIssueBucket({
    status: issue.status,
    labels: [],
    summary: issue.summary,
  });
}

export function isDoneStatus(
  issue: Pick<CompactIssueSummary, "status" | "statusCategory">,
): boolean {
  const category = (issue.statusCategory ?? "").toLowerCase();
  if (category === "done") {
    return true;
  }
  const status = issue.status.toLowerCase();
  return ["done", "closed", "resolved", "complete", "completed"].includes(status);
}

export function isInProgressStatus(
  issue: Pick<CompactIssueSummary, "status" | "statusCategory">,
): boolean {
  const category = (issue.statusCategory ?? "").toLowerCase();
  if (category === "indeterminate") {
    return true;
  }
  const status = issue.status.toLowerCase();
  return (
    status.includes("progress") ||
    status.includes("review") ||
    status.includes("testing") ||
    status.includes("qa") ||
    status === "in development"
  );
}

/**
 * Blocked detection uses explicit signals only (status / label / summary keyword).
 * Age alone must never mark an issue blocked.
 */
export function isExplicitlyBlocked(
  issue: Pick<CompactIssueSummary, "status" | "labels" | "summary">,
): boolean {
  const status = issue.status.toLowerCase();
  if (status.includes("block")) {
    return true;
  }
  if ((issue.labels ?? []).some((label) => label.toLowerCase().includes("block"))) {
    return true;
  }
  if (/\bblocked\b/i.test(issue.summary ?? "")) {
    return true;
  }
  return false;
}

export function blockedReason(
  issue: Pick<CompactIssueSummary, "status" | "labels" | "summary">,
): string | undefined {
  if (!isExplicitlyBlocked(issue)) {
    return undefined;
  }
  const status = issue.status.toLowerCase();
  if (status.includes("block")) {
    return `Status is "${issue.status}"`;
  }
  const label = (issue.labels ?? []).find((l) => l.toLowerCase().includes("block"));
  if (label) {
    return `Label "${label}"`;
  }
  if (/\bblocked\b/i.test(issue.summary ?? "")) {
    return "Summary contains blocked keyword";
  }
  return "Explicit blocked signal";
}

export function countWorkBuckets(
  issues: Array<Pick<CompactIssueSummary, "status" | "statusCategory" | "labels" | "summary">>,
): WorkCounts {
  const counts: WorkCounts = { total: issues.length, todo: 0, inProgress: 0, done: 0, blocked: 0 };
  for (const issue of issues) {
    const bucket = classifyIssueBucket(issue);
    counts[bucket] += 1;
  }
  return counts;
}

export function countSprintWorkBuckets(issues: CompactSprintIssue[]): WorkCounts {
  const counts: WorkCounts = { total: issues.length, todo: 0, inProgress: 0, done: 0, blocked: 0 };
  for (const issue of issues) {
    counts[classifySprintIssueBucket(issue)] += 1;
  }
  return counts;
}

export function progressPercentages(done: number, total: number): {
  completedPercentage: number;
  remainingPercentage: number;
} {
  if (total <= 0) {
    return { completedPercentage: 0, remainingPercentage: 0 };
  }
  const completedPercentage = Math.round((done / total) * 1000) / 10;
  return {
    completedPercentage,
    remainingPercentage: Math.round((100 - completedPercentage) * 10) / 10,
  };
}

/**
 * Extract Jira-like issue keys from text.
 * When projectKey is provided, only keys matching that project are returned (isolation).
 */
export function extractIssueKeys(text: string, projectKey?: string): string[] {
  if (!text) {
    return [];
  }
  const found = new Set<string>();
  ISSUE_KEY_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ISSUE_KEY_PATTERN.exec(text)) !== null) {
    const key = match[1];
    if (!key) {
      continue;
    }
    if (projectKey) {
      const prefix = `${projectKey.toUpperCase()}-`;
      if (!key.toUpperCase().startsWith(prefix)) {
        continue;
      }
    }
    found.add(key.toUpperCase());
  }
  return [...found];
}

export function extractIssueKeysFromPr(
  pr: Pick<CompactPullRequestSummary, "title" | "sourceBranch"> & { body?: string },
  projectKey?: string,
): string[] {
  const parts = [pr.title, pr.sourceBranch ?? "", pr.body ?? ""].join("\n");
  return extractIssueKeys(parts, projectKey);
}

export function summarizeReviews(reviews: CompactReview[]): {
  approved: number;
  changesRequested: number;
  waiting: boolean;
} {
  let approved = 0;
  let changesRequested = 0;
  for (const review of reviews) {
    const state = (review.state ?? "").toUpperCase();
    if (state === "APPROVED") {
      approved += 1;
    } else if (state === "CHANGES_REQUESTED") {
      changesRequested += 1;
    }
  }
  return {
    approved,
    changesRequested,
    waiting: approved === 0 && changesRequested === 0,
  };
}

export function average(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

export function maxNumber(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  return Math.max(...values);
}

export function prChangeSize(
  pr: Pick<CompactPullRequestDetail, "additions" | "deletions">,
): number | undefined {
  if (pr.additions === undefined && pr.deletions === undefined) {
    return undefined;
  }
  return (pr.additions ?? 0) + (pr.deletions ?? 0);
}

export function evaluatePrRiskLevel(input: {
  ageHours?: number;
  ciFailed: boolean;
  changesRequested: boolean;
  waitingForReview: boolean;
  waitingHours?: number;
  changeSize?: number;
  thresholds: {
    prStaleHours: number;
    prHighRiskHours: number;
    prLargeChanges: number;
    prReviewWaitingHours: number;
  };
}): RiskSeverity {
  const { thresholds } = input;
  let level: RiskSeverity = "low";

  const raise = (candidate: RiskSeverity) => {
    const order: RiskSeverity[] = ["low", "medium", "high", "critical"];
    if (order.indexOf(candidate) > order.indexOf(level)) {
      level = candidate;
    }
  };

  if (input.ciFailed || input.changesRequested) {
    raise("high");
  }
  if (input.ageHours !== undefined && input.ageHours > thresholds.prHighRiskHours) {
    raise("high");
  }
  if (
    input.changeSize !== undefined &&
    input.changeSize > thresholds.prLargeChanges * 2
  ) {
    raise("high");
  }

  if (input.ageHours !== undefined && input.ageHours > thresholds.prStaleHours) {
    raise("medium");
  }
  if (
    input.waitingForReview &&
    input.waitingHours !== undefined &&
    input.waitingHours > thresholds.prReviewWaitingHours
  ) {
    raise("medium");
  }
  if (input.changeSize !== undefined && input.changeSize > thresholds.prLargeChanges) {
    raise("medium");
  }

  return level;
}

export function clampPositiveInt(value: number, field: string, max?: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new EngineeringValidationError(`${field} must be a positive integer`);
  }
  if (max !== undefined && value > max) {
    throw new EngineeringValidationError(`${field} must be <= ${max}`);
  }
  return value;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
