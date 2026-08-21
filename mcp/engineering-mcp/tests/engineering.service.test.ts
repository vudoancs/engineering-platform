import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ProjectConfigLoader, ProjectConfigService } from "engineering-platform/config";
import { McpProjectNotFoundError } from "../src/errors/mcp-errors.js";
import type { ConfluenceService } from "../src/integrations/confluence/confluence.service.js";
import type { GitHubService } from "../src/integrations/github/github.service.js";
import type { JiraService } from "../src/integrations/jira/jira.service.js";
import { EngineeringService } from "../src/services/engineering/engineering.service.js";
import { JiraConfigurationError } from "../src/integrations/jira/jira.errors.js";
import { GitHubConfigurationError } from "../src/integrations/github/github.errors.js";
import { ConfluenceConfigurationError } from "../src/integrations/confluence/confluence.errors.js";

const projectsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../projects",
);

function projectConfig(): ProjectConfigService {
  return new ProjectConfigService({
    loader: new ProjectConfigLoader({ projectsDir }),
  });
}

function issue(partial: Record<string, unknown>) {
  return {
    key: "KYGO-1",
    summary: "Sample",
    status: "To Do",
    issueType: "Task",
    labels: [],
    ...partial,
  };
}

function mockJira(overrides: Partial<JiraService> = {}): JiraService {
  return {
    isConfigured: () => true,
    searchIssues: vi.fn(async () => ({ projectId: "kygo", total: 0, issues: [] })),
    getSprint: vi.fn(async () => ({
      id: 1,
      name: "Sprint 1",
      state: "active",
      issues: [],
    })),
    getProject: vi.fn(),
    getIssue: vi.fn(),
    getIssueComments: vi.fn(),
    getIssueTransitions: vi.fn(),
    getCurrentUser: vi.fn(),
    ...overrides,
  } as unknown as JiraService;
}

function mockGitHub(overrides: Partial<GitHubService> = {}): GitHubService {
  return {
    isConfigured: () => true,
    getRepositories: vi.fn(async () => ({
      projectId: "kygo",
      repositories: [{ name: "kygo", fullName: "org/kygo", private: true }],
    })),
    listPullRequests: vi.fn(async () => ({
      pullRequests: [],
      pagination: { page: 1, perPage: 20 },
    })),
    getPullRequest: vi.fn(),
    listPullRequestReviews: vi.fn(async () => ({ reviews: [] })),
    getPullRequestChecks: vi.fn(async () => ({ status: "completed", checks: [] })),
    getContributors: vi.fn(async () => ({
      contributors: [],
      pagination: { page: 1, perPage: 20 },
    })),
    ...overrides,
  } as unknown as GitHubService;
}

function mockConfluence(overrides: Partial<ConfluenceService> = {}): ConfluenceService {
  return {
    isConfigured: () => true,
    searchPages: vi.fn(async () => ({ projectId: "kygo", limit: 20, pages: [], total: 0 })),
    getSpace: vi.fn(),
    getPage: vi.fn(),
    getPageChildren: vi.fn(),
    getPageAncestors: vi.fn(),
    getPageLabels: vi.fn(),
    assertAllowedSpace: vi.fn(),
    ...overrides,
  } as unknown as ConfluenceService;
}

const fixedNow = () => new Date("2026-08-21T12:00:00.000Z");

describe("EngineeringService", () => {
  it("returns normal project status when all sources ok", async () => {
    const jira = mockJira({
      searchIssues: vi.fn(async (_p, jql?: string) => {
        if (jql?.includes("openSprints")) {
          return {
            projectId: "kygo",
            total: 1,
            issues: [issue({ key: "KYGO-10", status: "In Progress", statusCategory: "In Progress" })],
          };
        }
        return {
          projectId: "kygo",
          total: 2,
          issues: [
            issue({ key: "KYGO-1", status: "To Do", statusCategory: "To Do" }),
            issue({
              key: "KYGO-2",
              status: "Done",
              statusCategory: "Done",
            }),
          ],
        };
      }),
    });
    const github = mockGitHub({
      listPullRequests: vi.fn(async (_p, _r, opts?: { state?: string }) => ({
        pullRequests:
          opts?.state === "open"
            ? [
                {
                  number: 7,
                  title: "KYGO-1 feature",
                  state: "open",
                  draft: false,
                  author: "alice",
                  sourceBranch: "feature/KYGO-1",
                  targetBranch: "main",
                  createdAt: "2026-08-20T12:00:00.000Z",
                },
              ]
            : [],
        pagination: { page: 1, perPage: 20 },
      })),
      getPullRequest: vi.fn(async () => ({
        number: 7,
        title: "KYGO-1 feature",
        state: "open",
        draft: false,
        merged: false,
        body: "Implements KYGO-1",
        sourceBranch: "feature/KYGO-1",
        targetBranch: "main",
        createdAt: "2026-08-20T12:00:00.000Z",
        additions: 10,
        deletions: 2,
      })),
      getPullRequestChecks: vi.fn(async () => ({
        status: "completed",
        conclusion: "success",
        checks: [{ name: "ci", status: "completed", conclusion: "success" }],
      })),
    });
    const confluence = mockConfluence({
      searchPages: vi.fn(async () => ({
        projectId: "kygo",
        limit: 20,
        total: 1,
        pages: [
          {
            id: "1",
            title: "Arch",
            spaceKey: "KYGO",
            url: "https://example/wiki",
            updatedAt: "2026-08-15T00:00:00.000Z",
          },
        ],
      })),
    });

    const service = new EngineeringService({
      jira,
      github,
      confluence,
      projectConfigService: projectConfig(),
      now: fixedNow,
    });

    const status = await service.getProjectStatus("kygo");
    expect(status.sources).toEqual({ jira: "ok", github: "ok", confluence: "ok" });
    expect(status.work).toMatchObject({ total: 2, done: 1, todo: 1 });
    expect(status.delivery).toMatchObject({ openPullRequests: 1 });
    expect(status.documentation).toMatchObject({ pagesFound: 1 });
  });

  it("degrades when Jira unavailable", async () => {
    const jira = mockJira({
      searchIssues: vi.fn(async () => {
        throw new JiraConfigurationError("down");
      }),
    });
    const service = new EngineeringService({
      jira,
      github: mockGitHub(),
      confluence: mockConfluence(),
      projectConfigService: projectConfig(),
      now: fixedNow,
    });
    const status = await service.getProjectStatus("kygo");
    expect(status.sources.jira).toBe("unavailable");
    expect(status.work).toMatchObject({ status: "unknown" });
    expect(status.delivery).not.toMatchObject({ status: "unknown" });
  });

  it("degrades when GitHub unavailable", async () => {
    const github = mockGitHub({
      getRepositories: vi.fn(async () => {
        throw new GitHubConfigurationError("down");
      }),
    });
    const service = new EngineeringService({
      jira: mockJira({
        searchIssues: vi.fn(async () => ({
          projectId: "kygo",
          total: 0,
          issues: [],
        })),
      }),
      github,
      confluence: mockConfluence(),
      projectConfigService: projectConfig(),
      now: fixedNow,
    });
    const status = await service.getProjectStatus("kygo");
    expect(status.sources.github).toBe("unavailable");
    expect(status.delivery).toMatchObject({ status: "unknown" });
  });

  it("degrades when Confluence unavailable", async () => {
    const confluence = mockConfluence({
      searchPages: vi.fn(async () => {
        throw new ConfluenceConfigurationError("down");
      }),
    });
    const service = new EngineeringService({
      jira: mockJira(),
      github: mockGitHub(),
      confluence,
      projectConfigService: projectConfig(),
      now: fixedNow,
    });
    const status = await service.getProjectStatus("kygo");
    expect(status.sources.confluence).toBe("unavailable");
    expect(status.documentation).toMatchObject({ status: "unknown" });
  });

  it("handles all sources unavailable / not configured", async () => {
    const service = new EngineeringService({
      jira: null,
      github: null,
      confluence: null,
      projectConfigService: projectConfig(),
      now: fixedNow,
    });
    const status = await service.getProjectStatus("kygo");
    expect(status.sources).toEqual({
      jira: "not_configured",
      github: "not_configured",
      confluence: "not_configured",
    });
    expect(status.work).toMatchObject({ status: "unknown" });
    expect(status.delivery).toMatchObject({ status: "unknown" });
    expect(status.documentation).toMatchObject({ status: "unknown" });
  });

  it("detects stale and blocked work", async () => {
    const jira = mockJira({
      searchIssues: vi.fn(async () => ({
        projectId: "kygo",
        total: 2,
        issues: [
          issue({
            key: "KYGO-3",
            status: "In Progress",
            statusCategory: "In Progress",
            updatedAt: "2026-07-01T00:00:00.000Z",
            assignee: "bob",
          }),
          issue({
            key: "KYGO-4",
            status: "Blocked",
            labels: ["blocked"],
            summary: "Need help",
            updatedAt: "2026-08-20T00:00:00.000Z",
          }),
        ],
      })),
    });
    const service = new EngineeringService({
      jira,
      github: null,
      confluence: null,
      projectConfigService: projectConfig(),
      now: fixedNow,
    });

    const stale = await service.getStaleWork("kygo", 7);
    expect(stale.issues.map((i) => i.key)).toContain("KYGO-3");
    expect(stale.issues.map((i) => i.key)).not.toContain("KYGO-4");

    const blocked = await service.getBlockedWork("kygo");
    expect(blocked.issues).toHaveLength(1);
    expect(blocked.issues[0]?.key).toBe("KYGO-4");
    expect(blocked.issues[0]?.blockedReason).toBeTruthy();
  });

  it("detects failed CI and stale PR waiting for review", async () => {
    const github = mockGitHub({
      listPullRequests: vi.fn(async () => ({
        pullRequests: [
          {
            number: 9,
            title: "slow PR",
            state: "open",
            draft: false,
            createdAt: "2026-08-17T12:00:00.000Z",
            sourceBranch: "feat/x",
            targetBranch: "main",
          },
        ],
        pagination: { page: 1, perPage: 20 },
      })),
      getPullRequest: vi.fn(async () => ({
        number: 9,
        title: "slow PR",
        state: "open",
        draft: false,
        merged: false,
        createdAt: "2026-08-17T12:00:00.000Z",
        additions: 10,
        deletions: 10,
      })),
      listPullRequestReviews: vi.fn(async () => ({ reviews: [] })),
      getPullRequestChecks: vi.fn(async () => ({
        status: "completed",
        conclusion: "failure",
        checks: [{ name: "ci", conclusion: "failure" }],
      })),
    });

    const service = new EngineeringService({
      jira: null,
      github,
      confluence: null,
      projectConfigService: projectConfig(),
      now: fixedNow,
    });

    const prs = await service.getPRStatus("kygo");
    expect(prs.pullRequests[0]?.ci.conclusion).toBe("failure");
    expect(prs.pullRequests[0]?.review.waiting).toBe(true);
    expect(prs.pullRequests[0]?.riskLevel).toBe("high");

    const report = await service.getRiskReport("kygo");
    expect(report.risks.some((r) => r.type === "PR_CI_FAILED")).toBe(true);
    expect(report.risks.some((r) => r.type === "PR_STALE" || r.type === "PR_HIGH_AGE")).toBe(true);
  });

  it("correlates Jira keys from PR and reports no correlation when absent", async () => {
    const github = mockGitHub({
      listPullRequests: vi.fn(async () => ({
        pullRequests: [
          {
            number: 1,
            title: "KYGO-55 login",
            state: "open",
            draft: false,
            sourceBranch: "feature/KYGO-55",
            createdAt: "2026-08-21T00:00:00.000Z",
          },
          {
            number: 2,
            title: "docs tweak",
            state: "open",
            draft: false,
            sourceBranch: "chore/docs",
            createdAt: "2026-08-21T00:00:00.000Z",
          },
        ],
        pagination: { page: 1, perPage: 20 },
      })),
      getPullRequest: vi.fn(async (_p, _r, n: number) => ({
        number: n,
        title: n === 1 ? "KYGO-55 login" : "docs tweak",
        state: "open",
        draft: false,
        merged: false,
        body: n === 1 ? "KYGO-55" : "no ticket",
        sourceBranch: n === 1 ? "feature/KYGO-55" : "chore/docs",
        createdAt: "2026-08-21T00:00:00.000Z",
      })),
    });

    const service = new EngineeringService({
      jira: null,
      github,
      confluence: null,
      projectConfigService: projectConfig(),
      now: fixedNow,
    });

    const result = await service.getPRStatus("kygo");
    const linked = result.pullRequests.find((p) => p.number === 1);
    const unlinked = result.pullRequests.find((p) => p.number === 2);
    expect(linked?.jiraIssues.some((j) => j.key === "KYGO-55" && j.linked)).toBe(true);
    expect(unlinked?.jiraIssues).toEqual([{ linked: false }]);
  });

  it("handles empty sprint and zero tickets", async () => {
    const jira = mockJira({
      getSprint: vi.fn(async () => ({
        id: 99,
        name: "Empty",
        state: "active",
        issues: [],
      })),
    });
    const service = new EngineeringService({
      jira,
      github: null,
      confluence: null,
      projectConfigService: projectConfig(),
      now: fixedNow,
    });
    const sprint = await service.getSprintStatus("kygo", 99);
    expect(sprint.tickets).toMatchObject({ total: 0, done: 0 });
    expect(sprint.progress).toEqual({ completedPercentage: 0, remainingPercentage: 0 });
  });

  it("handles zero PRs", async () => {
    const service = new EngineeringService({
      jira: null,
      github: mockGitHub(),
      confluence: null,
      projectConfigService: projectConfig(),
      now: fixedNow,
    });
    const delivery = await service.getDeliveryStatus("kygo");
    expect(delivery.pullRequests).toMatchObject({
      open: 0,
      waitingForReview: 0,
      stale: 0,
      failedCI: 0,
    });
  });

  it("flags large PR risk", async () => {
    const github = mockGitHub({
      listPullRequests: vi.fn(async () => ({
        pullRequests: [
          {
            number: 3,
            title: "huge",
            state: "open",
            draft: false,
            createdAt: "2026-08-21T00:00:00.000Z",
          },
        ],
        pagination: { page: 1, perPage: 20 },
      })),
      getPullRequest: vi.fn(async () => ({
        number: 3,
        title: "huge",
        state: "open",
        draft: false,
        merged: false,
        createdAt: "2026-08-21T00:00:00.000Z",
        additions: 400,
        deletions: 200,
      })),
    });
    const service = new EngineeringService({
      jira: null,
      github,
      confluence: null,
      projectConfigService: projectConfig(),
      now: fixedNow,
    });
    const report = await service.getRiskReport("kygo");
    expect(report.risks.some((r) => r.type === "LARGE_PR")).toBe(true);
  });

  it("aggregates multiple risks and exposes source health", async () => {
    const jira = mockJira({
      searchIssues: vi.fn(async () => ({
        projectId: "kygo",
        total: 1,
        issues: [
          issue({
            key: "KYGO-8",
            status: "Blocked",
            updatedAt: "2026-07-01T00:00:00.000Z",
          }),
        ],
      })),
    });
    const github = mockGitHub({
      listPullRequests: vi.fn(async () => ({
        pullRequests: [
          {
            number: 11,
            title: "x",
            state: "open",
            draft: false,
            createdAt: "2026-08-10T00:00:00.000Z",
          },
        ],
        pagination: { page: 1, perPage: 20 },
      })),
      getPullRequestChecks: vi.fn(async () => ({
        status: "completed",
        conclusion: "failure",
        checks: [{ name: "ci", conclusion: "failure" }],
      })),
      getPullRequest: vi.fn(async () => ({
        number: 11,
        title: "x",
        state: "open",
        draft: false,
        merged: false,
        createdAt: "2026-08-10T00:00:00.000Z",
        additions: 1,
        deletions: 1,
      })),
    });

    const service = new EngineeringService({
      jira,
      github,
      confluence: null,
      projectConfigService: projectConfig(),
      now: fixedNow,
    });
    const report = await service.getRiskReport("kygo");
    expect(report.risks.length).toBeGreaterThanOrEqual(2);
    expect(report.sources.jira).toBe("ok");
    expect(report.sources.github).toBe("ok");
    expect(["high", "critical"]).toContain(report.overallRisk);
  });

  it("rejects unknown project (isolation)", async () => {
    const service = new EngineeringService({
      jira: mockJira(),
      github: mockGitHub(),
      confluence: mockConfluence(),
      projectConfigService: projectConfig(),
      now: fixedNow,
    });
    await expect(service.getProjectStatus("unknown-project")).rejects.toBeInstanceOf(
      McpProjectNotFoundError,
    );
  });

  it("team status aggregates without ranking scores", async () => {
    const jira = mockJira({
      searchIssues: vi.fn(async () => ({
        projectId: "kygo",
        total: 1,
        issues: [
          issue({
            key: "KYGO-1",
            assignee: "alice",
            status: "In Progress",
            statusCategory: "In Progress",
          }),
        ],
      })),
    });
    const github = mockGitHub({
      getContributors: vi.fn(async () => ({
        contributors: [{ login: "alice", contributions: 12 }],
        pagination: { page: 1, perPage: 20 },
      })),
      listPullRequests: vi.fn(async () => ({
        pullRequests: [],
        pagination: { page: 1, perPage: 20 },
      })),
    });
    const service = new EngineeringService({
      jira,
      github,
      confluence: null,
      projectConfigService: projectConfig(),
      now: fixedNow,
    });
    const team = await service.getTeamStatus("kygo");
    expect(team.note.toLowerCase()).toContain("not a performance");
    expect(team.members[0]).not.toHaveProperty("score");
    expect(team.members[0]?.work.inProgress).toBe(1);
  });
});
