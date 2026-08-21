import {
  ProjectConfigMissingError,
  ProjectNotFoundError,
  type ProjectConfigService,
} from "engineering-platform/config";
import { McpProjectNotFoundError } from "../../errors/mcp-errors.js";
import { JiraClient } from "./jira.client.js";
import {
  JiraConfigurationError,
  JiraProjectBoundaryError,
  JiraValidationError,
} from "./jira.errors.js";
import { constrainJqlToProject } from "./jira.jql.js";
import { jiraControlledUpdateIssue } from "./jira.write.js";
import {
  getIssueProjectKey,
  mapComments,
  mapCurrentUser,
  mapIssueDetail,
  mapProject,
  mapSearchResult,
  mapSprint,
  mapTransitions,
} from "./jira.mapper.js";
import type {
  CompactCommentsResult,
  CompactCurrentUser,
  CompactIssueDetail,
  CompactIssueSearchResult,
  CompactProject,
  CompactSprint,
  CompactTransitionsResult,
  JiraApproximateCountResponse,
  JiraCommentsApiResponse,
  JiraIssueApi,
  JiraProjectRef,
  JiraSearchApiResponse,
  JiraSprintApi,
  JiraSprintIssuesApiResponse,
  JiraTransitionsApiResponse,
  JiraUserRef,
} from "./jira.types.js";

const ISSUE_FIELDS = [
  "summary",
  "status",
  "issuetype",
  "priority",
  "assignee",
  "reporter",
  "labels",
  "created",
  "updated",
  "duedate",
  "project",
  "description",
  "components",
].join(",");

const SPRINT_ISSUE_FIELDS = ["summary", "status", "assignee", "project"].join(",");

export interface JiraServiceOptions {
  projectConfigService: ProjectConfigService;
  client?: JiraClient | null;
}

/**
 * Project-agnostic Jira read operations.
 * Resolves Jira project keys exclusively through ProjectConfigService.
 */
export class JiraService {
  private readonly projectConfigService: ProjectConfigService;
  private readonly client: JiraClient | null;

  constructor(options: JiraServiceOptions) {
    this.projectConfigService = options.projectConfigService;
    this.client = options.client ?? null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async searchIssues(
    projectId: string,
    jql?: string,
    maxResults = 20,
  ): Promise<CompactIssueSearchResult> {
    const client = this.requireClient();
    const projectKey = this.resolveJiraProjectKey(projectId);
    const clamped = clampMaxResults(maxResults);
    const constrained = constrainJqlToProject(projectKey, jql);

    const [search, total] = await Promise.all([
      client.post<JiraSearchApiResponse>("/rest/api/3/search/jql", {
        jql: constrained.jql,
        maxResults: clamped,
        fields: ISSUE_FIELDS.split(","),
      }),
      this.approximateCount(client, constrained.jql),
    ]);

    return mapSearchResult(projectId, search, total);
  }

  async getIssue(projectId: string, issueKey: string): Promise<CompactIssueDetail> {
    const client = this.requireClient();
    const projectKey = this.resolveJiraProjectKey(projectId);
    const issue = await client.get<JiraIssueApi>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
      { fields: ISSUE_FIELDS },
    );

    this.assertIssueBelongsToProject(projectId, projectKey, issue);
    return mapIssueDetail(projectId, issue, client.getBrowseBaseUrl());
  }

  async getProject(projectId: string): Promise<CompactProject> {
    const client = this.requireClient();
    const projectKey = this.resolveJiraProjectKey(projectId);
    const project = await client.get<JiraProjectRef>(
      `/rest/api/3/project/${encodeURIComponent(projectKey)}`,
    );

    if (project.key && project.key.toUpperCase() !== projectKey.toUpperCase()) {
      throw new JiraProjectBoundaryError(
        `Jira project "${project.key}" does not match configured project for "${projectId}".`,
      );
    }

    return mapProject(projectId, project, client.getBrowseBaseUrl());
  }

  async getSprint(projectId: string, sprintId: number): Promise<CompactSprint> {
    const client = this.requireClient();
    const projectKey = this.resolveJiraProjectKey(projectId);

    if (!Number.isInteger(sprintId) || sprintId <= 0) {
      throw new JiraValidationError("sprintId must be a positive integer");
    }

    const sprint = await client.get<JiraSprintApi>(
      `/rest/agile/1.0/sprint/${encodeURIComponent(String(sprintId))}`,
    );

    const constrainedIssues = await client.get<JiraSprintIssuesApiResponse>(
      `/rest/agile/1.0/sprint/${encodeURIComponent(String(sprintId))}/issue`,
      {
        maxResults: 100,
        fields: SPRINT_ISSUE_FIELDS,
        jql: `project = "${projectKey}"`,
      },
    );

    const allIssuesProbe = await client.get<JiraSprintIssuesApiResponse>(
      `/rest/agile/1.0/sprint/${encodeURIComponent(String(sprintId))}/issue`,
      {
        maxResults: 50,
        fields: "project",
      },
    );

    for (const issue of allIssuesProbe.issues ?? []) {
      const key = getIssueProjectKey(issue);
      if (key && key.toUpperCase() !== projectKey.toUpperCase()) {
        throw new JiraProjectBoundaryError(
          `Sprint ${sprintId} contains issue ${issue.key} outside project "${projectId}" (${projectKey}).`,
        );
      }
    }

    // Empty sprint: verify ownership via project-constrained issue query returning without foreign issues.
    // If probe found no issues at all, accept empty sprint metadata for the configured project scope.
    return mapSprint(sprint, constrainedIssues.issues ?? []);
  }

  async getIssueComments(
    projectId: string,
    issueKey: string,
  ): Promise<CompactCommentsResult> {
    const client = this.requireClient();
    const projectKey = this.resolveJiraProjectKey(projectId);
    await this.getIssueAndAssertBoundary(client, projectId, projectKey, issueKey);

    const comments = await client.get<JiraCommentsApiResponse>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
      { maxResults: 100 },
    );

    return mapComments(issueKey, comments);
  }

  async getIssueTransitions(
    projectId: string,
    issueKey: string,
  ): Promise<CompactTransitionsResult> {
    const client = this.requireClient();
    const projectKey = this.resolveJiraProjectKey(projectId);
    await this.getIssueAndAssertBoundary(client, projectId, projectKey, issueKey);

    const transitions = await client.get<JiraTransitionsApiResponse>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    );

    return mapTransitions(issueKey, transitions);
  }

  async getCurrentUser(): Promise<CompactCurrentUser> {
    const client = this.requireClient();
    const user = await client.get<JiraUserRef>("/rest/api/3/myself");
    return mapCurrentUser(user);
  }

  /**
   * Controlled write: status (transition), comment, labels only.
   */
  async updateIssueControlled(
    projectId: string,
    issueKey: string,
    fields: { status?: string; comment?: string; labels?: string[] },
  ): Promise<{ issueKey: string; updated: string[] }> {
    const client = this.requireClient();
    const projectKey = this.resolveJiraProjectKey(projectId);
    await this.getIssueAndAssertBoundary(client, projectId, projectKey, issueKey);
    return jiraControlledUpdateIssue(client, { issueKey, fields });
  }

  private async getIssueAndAssertBoundary(
    client: JiraClient,
    projectId: string,
    projectKey: string,
    issueKey: string,
  ): Promise<JiraIssueApi> {
    const issue = await client.get<JiraIssueApi>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
      { fields: "project" },
    );
    this.assertIssueBelongsToProject(projectId, projectKey, issue);
    return issue;
  }

  private assertIssueBelongsToProject(
    projectId: string,
    projectKey: string,
    issue: JiraIssueApi,
  ): void {
    const actual = getIssueProjectKey(issue);
    if (!actual) {
      throw new JiraValidationError(
        `Issue ${issue.key} is missing project metadata from Jira.`,
      );
    }

    if (actual.toUpperCase() !== projectKey.toUpperCase()) {
      throw new JiraProjectBoundaryError(
        `Issue ${issue.key} does not belong to project ${projectId}.`,
        {
          details: {
            projectId,
            expectedProjectKey: projectKey,
            actualProjectKey: actual,
            issueKey: issue.key,
          },
        },
      );
    }
  }

  private resolveJiraProjectKey(projectId: string): string {
    try {
      const jira = this.projectConfigService.getJiraConfig(projectId);
      return jira.projectKey;
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new McpProjectNotFoundError(projectId, { cause: error });
      }
      if (error instanceof ProjectConfigMissingError) {
        throw new JiraConfigurationError(
          `Project "${projectId}" does not define jira.projectKey in project configuration.`,
          { cause: error, details: { projectId } },
        );
      }
      throw error;
    }
  }

  private requireClient(): JiraClient {
    if (!this.client) {
      throw new JiraConfigurationError(
        "Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN.",
      );
    }
    return this.client;
  }

  private async approximateCount(client: JiraClient, jql: string): Promise<number> {
    try {
      const result = await client.post<JiraApproximateCountResponse>(
        "/rest/api/3/search/approximate-count",
        { jql },
      );
      return typeof result.count === "number" ? result.count : 0;
    } catch {
      return 0;
    }
  }
}

function clampMaxResults(maxResults: number): number {
  if (!Number.isFinite(maxResults) || maxResults < 1) {
    throw new JiraValidationError("maxResults must be a positive number");
  }
  if (maxResults > 100) {
    throw new JiraValidationError("maxResults must be <= 100");
  }
  return Math.floor(maxResults);
}

export function createJiraClientFromEnv(env: {
  JIRA_BASE_URL?: string;
  JIRA_EMAIL?: string;
  JIRA_API_TOKEN?: string;
  JIRA_REQUEST_TIMEOUT_MS?: number;
}): JiraClient | null {
  const baseUrl = env.JIRA_BASE_URL?.trim();
  const email = env.JIRA_EMAIL?.trim();
  const apiToken = env.JIRA_API_TOKEN?.trim();

  if (!baseUrl && !email && !apiToken) {
    return null;
  }

  if (!baseUrl || !email || !apiToken) {
    throw new JiraConfigurationError(
      "Incomplete Jira configuration. Provide JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN together.",
    );
  }

  return new JiraClient({
    baseUrl,
    email,
    apiToken,
    timeoutMs: env.JIRA_REQUEST_TIMEOUT_MS ?? 10_000,
  });
}
