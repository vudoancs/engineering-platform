import type {
  CompactComment,
  CompactCommentsResult,
  CompactCurrentUser,
  CompactIssueDetail,
  CompactIssueSearchResult,
  CompactIssueSummary,
  CompactProject,
  CompactSprint,
  CompactSprintIssue,
  CompactTransition,
  CompactTransitionsResult,
  JiraCommentApi,
  JiraCommentsApiResponse,
  JiraIssueApi,
  JiraProjectRef,
  JiraSearchApiResponse,
  JiraSprintApi,
  JiraTransitionApi,
  JiraTransitionsApiResponse,
  JiraUserRef,
} from "./jira.types.js";

const MAX_TEXT_LENGTH = 4000;

export function truncateText(value: string, maxLength = MAX_TEXT_LENGTH): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}…`;
}

/**
 * Extract plain text from Jira ADF or string descriptions/comments.
 */
export function extractPlainText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return truncateText(value.trim());
  }

  if (typeof value !== "object") {
    return truncateText(String(value));
  }

  const chunks: string[] = [];
  walkAdf(value, chunks);
  return truncateText(chunks.join(" ").replace(/\s+/g, " ").trim());
}

function walkAdf(node: unknown, chunks: string[]): void {
  if (node === null || node === undefined) {
    return;
  }

  if (typeof node === "string") {
    chunks.push(node);
    return;
  }

  if (typeof node !== "object") {
    return;
  }

  const record = node as Record<string, unknown>;
  if (typeof record.text === "string") {
    chunks.push(record.text);
  }

  if (Array.isArray(record.content)) {
    for (const child of record.content) {
      walkAdf(child, chunks);
    }
  }
}

function displayName(user: JiraUserRef | null | undefined): string | undefined {
  if (!user) {
    return undefined;
  }
  return user.displayName ?? user.emailAddress ?? user.accountId;
}

export function mapIssueSummary(issue: JiraIssueApi): CompactIssueSummary {
  const fields = issue.fields ?? {};
  const summary: CompactIssueSummary = {
    key: issue.key,
    summary: fields.summary ?? "",
    status: fields.status?.name ?? "Unknown",
    issueType: fields.issuetype?.name ?? "Unknown",
    labels: fields.labels ?? [],
  };

  if (fields.status?.statusCategory?.name) {
    summary.statusCategory = fields.status.statusCategory.name;
  }
  if (fields.priority?.name) {
    summary.priority = fields.priority.name;
  }
  const assignee = displayName(fields.assignee ?? undefined);
  if (assignee) {
    summary.assignee = assignee;
  }
  const reporter = displayName(fields.reporter ?? undefined);
  if (reporter) {
    summary.reporter = reporter;
  }
  if (fields.created) {
    summary.createdAt = fields.created;
  }
  if (fields.updated) {
    summary.updatedAt = fields.updated;
  }
  if (fields.duedate) {
    summary.dueDate = fields.duedate;
  }

  return summary;
}

export function mapIssueDetail(
  projectId: string,
  issue: JiraIssueApi,
  browseBaseUrl: string,
): CompactIssueDetail {
  const base = mapIssueSummary(issue);
  const fields = issue.fields ?? {};
  const description = extractPlainText(fields.description);

  const detail: CompactIssueDetail = {
    ...base,
    projectId,
    components: (fields.components ?? [])
      .map((component) => component.name)
      .filter((name): name is string => Boolean(name)),
    url: `${browseBaseUrl.replace(/\/$/, "")}/browse/${issue.key}`,
  };

  if (description) {
    detail.description = description;
  }

  return detail;
}

export function mapSearchResult(
  projectId: string,
  response: JiraSearchApiResponse,
  total: number,
): CompactIssueSearchResult {
  return {
    projectId,
    total,
    issues: (response.issues ?? []).map(mapIssueSummary),
  };
}

export function mapProject(
  projectId: string,
  project: JiraProjectRef,
  browseBaseUrl: string,
): CompactProject {
  const key = project.key ?? "";
  const result: CompactProject = {
    projectId,
    jiraProjectKey: key,
    name: project.name ?? key,
    url: `${browseBaseUrl.replace(/\/$/, "")}/browse/${key}`,
  };

  const description = extractPlainText(project.description);
  if (description) {
    result.description = description;
  }
  const lead = displayName(project.lead);
  if (lead) {
    result.lead = lead;
  }
  if (project.projectTypeKey) {
    result.projectType = project.projectTypeKey;
  }

  return result;
}

export function mapComments(
  issueKey: string,
  response: JiraCommentsApiResponse,
): CompactCommentsResult {
  return {
    issueKey,
    comments: (response.comments ?? []).map(mapComment),
  };
}

function mapComment(comment: JiraCommentApi): CompactComment {
  const mapped: CompactComment = {
    id: comment.id,
    body: extractPlainText(comment.body),
  };
  const author = displayName(comment.author);
  if (author) {
    mapped.author = author;
  }
  if (comment.created) {
    mapped.createdAt = comment.created;
  }
  if (comment.updated) {
    mapped.updatedAt = comment.updated;
  }
  return mapped;
}

export function mapTransitions(
  issueKey: string,
  response: JiraTransitionsApiResponse,
): CompactTransitionsResult {
  return {
    issueKey,
    transitions: (response.transitions ?? []).map(mapTransition),
  };
}

function mapTransition(transition: JiraTransitionApi): CompactTransition {
  return {
    id: transition.id,
    name: transition.name,
    toStatus: transition.to?.name ?? "Unknown",
  };
}

export function mapSprintIssue(issue: JiraIssueApi): CompactSprintIssue {
  const fields = issue.fields ?? {};
  const mapped: CompactSprintIssue = {
    key: issue.key,
    summary: fields.summary ?? "",
    status: fields.status?.name ?? "Unknown",
  };
  const assignee = displayName(fields.assignee ?? undefined);
  if (assignee) {
    mapped.assignee = assignee;
  }
  return mapped;
}

export function mapSprint(
  sprint: JiraSprintApi,
  issues: JiraIssueApi[],
): CompactSprint {
  const result: CompactSprint = {
    id: sprint.id,
    name: sprint.name ?? `Sprint ${sprint.id}`,
    issues: issues.map(mapSprintIssue),
  };
  if (sprint.state) {
    result.state = sprint.state;
  }
  if (sprint.startDate) {
    result.startDate = sprint.startDate;
  }
  if (sprint.endDate) {
    result.endDate = sprint.endDate;
  }
  if (sprint.goal) {
    result.goal = truncateText(sprint.goal, 1000);
  }
  return result;
}

export function mapCurrentUser(user: JiraUserRef): CompactCurrentUser {
  const result: CompactCurrentUser = {
    accountId: user.accountId ?? "",
    displayName: user.displayName ?? user.accountId ?? "Unknown",
    active: user.active ?? true,
  };
  if (user.emailAddress) {
    result.emailAddress = user.emailAddress;
  }
  if (user.timeZone) {
    result.timeZone = user.timeZone;
  }
  return result;
}

export function getIssueProjectKey(issue: JiraIssueApi): string | undefined {
  return issue.fields?.project?.key;
}
