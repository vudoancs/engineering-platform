import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ProjectConfigLoader, ProjectConfigService } from "../../src/config/index.js";
import {
  ApprovalRequiredError,
  DISABLED_WRITE_ACTIONS,
  ENABLED_WRITE_ACTIONS,
  ExecutionService,
  InMemoryIdempotencyService,
  InvalidParametersError,
  ProjectAccessDeniedError,
  ResourceOutOfScopeError,
  UnauthorizedAgentError,
  WRITE_ACTION_REGISTRY,
  slackMessageDisabledAction,
  slackMessageJiraApprovalRequired,
  slackMessagePrCreated,
  type GitHubWritePort,
  type JiraWritePort,
} from "../../src/execution/index.js";
import {
  GovernanceService,
  InMemoryAuditService,
} from "../../src/governance/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const projectsDir = path.join(repoRoot, "projects");
const policiesDir = path.join(repoRoot, "policies");

function createExecution(mocks?: {
  createBranch?: GitHubWritePort["createBranch"];
  createPullRequest?: GitHubWritePort["createPullRequest"];
  updateIssue?: JiraWritePort["updateIssue"];
  approvals?: Map<string, { id: string; projectId: string; action: string; status: "APPROVED" | "PENDING" | "REJECTED" }>;
}) {
  const audit = new InMemoryAuditService();
  const projectConfig = new ProjectConfigService({
    loader: new ProjectConfigLoader({ projectsDir }),
  });
  const governance = GovernanceService.loadFromDirectory({
    policiesDir,
    audit,
    isProjectKnown: (id) => {
      try {
        projectConfig.getProject(id);
        return true;
      } catch {
        return false;
      }
    },
  });

  const createBranch =
    mocks?.createBranch ??
    (vi.fn(async () => ({ ref: "refs/heads/feature/x", sha: "abc" })) as GitHubWritePort["createBranch"]);
  const createPullRequest =
    mocks?.createPullRequest ??
    (vi.fn(async () => ({
      number: 123,
      htmlUrl: "https://example.com/pr/123",
      title: "Test",
    })) as GitHubWritePort["createPullRequest"]);
  const updateIssue =
    mocks?.updateIssue ??
    (vi.fn(async () => ({
      issueKey: "KYGO-1",
      updated: ["comment"],
    })) as JiraWritePort["updateIssue"]);

  const approvals = mocks?.approvals ?? new Map();

  const execution = new ExecutionService({
    governance,
    projectConfig,
    isProjectKnown: (id) => {
      try {
        projectConfig.getProject(id);
        return true;
      } catch {
        return false;
      }
    },
    approvalLookup: {
      get: (id) => approvals.get(id),
    },
    githubWrite: { createBranch, createPullRequest },
    jiraWrite: { updateIssue },
    audit,
    idempotency: new InMemoryIdempotencyService(),
  });

  return { execution, audit, createBranch, createPullRequest, updateIssue, approvals };
}

describe("Controlled write execution", () => {
  it("registers enabled and disabled actions centrally", () => {
    expect(ENABLED_WRITE_ACTIONS).toContain("github.create_branch");
    expect(ENABLED_WRITE_ACTIONS).toContain("github.create_pull_request");
    expect(ENABLED_WRITE_ACTIONS).toContain("jira.update_issue");
    expect(DISABLED_WRITE_ACTIONS).toContain("github.merge_pull_request");
    expect(DISABLED_WRITE_ACTIONS).toContain("deploy.production");
    expect(WRITE_ACTION_REGISTRY["github.merge_pull_request"].enabled).toBe(false);
    expect(WRITE_ACTION_REGISTRY["github.merge_pull_request"].mcpToolName).toBeUndefined();
  });

  it("creates a branch via mock (valid)", async () => {
    const { execution, createBranch, audit } = createExecution();
    const result = await execution.execute({
      requestId: "req-1",
      projectId: "kygo",
      actor: { type: "agent", id: "developer" },
      agentId: "developer",
      action: "github.create_branch",
      resource: { repository: "your-github-org/kygo" },
      parameters: { branchName: "feature/demo", baseBranch: "main" },
      reason: "test",
    });
    expect(result.success).toBe(true);
    expect(createBranch).toHaveBeenCalledOnce();
    expect(audit.list().some((e) => e.action === "EXECUTION_COMPLETED")).toBe(true);
  });

  it("rejects invalid project", async () => {
    const { execution } = createExecution();
    await expect(
      execution.execute({
        requestId: "req-bad-project",
        projectId: "nope",
        actor: { type: "human", id: "u" },
        action: "github.create_branch",
        resource: {},
        parameters: { branchName: "feature/x", baseBranch: "main" },
        reason: "test",
      }),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });

  it("denies repository outside project", async () => {
    const { execution } = createExecution();
    await expect(
      execution.execute({
        requestId: "req-repo",
        projectId: "kygo",
        actor: { type: "agent", id: "developer" },
        agentId: "developer",
        action: "github.create_branch",
        resource: { repository: "another-company/private-repo" },
        parameters: {
          branchName: "feature/x",
          baseBranch: "main",
          repository: "another-company/private-repo",
        },
        reason: "test",
      }),
    ).rejects.toBeInstanceOf(ResourceOutOfScopeError);
  });

  it("rejects invalid branch name", async () => {
    const { execution } = createExecution();
    await expect(
      execution.execute({
        requestId: "req-branch",
        projectId: "kygo",
        actor: { type: "agent", id: "developer" },
        agentId: "developer",
        action: "github.create_branch",
        resource: { repository: "your-github-org/kygo" },
        parameters: { branchName: "main", baseBranch: "main" },
        reason: "test",
      }),
    ).rejects.toBeInstanceOf(InvalidParametersError);
  });

  it("creates a PR via mock", async () => {
    const { execution, createPullRequest } = createExecution();
    const result = await execution.execute({
      requestId: "req-pr",
      projectId: "kygo",
      actor: { type: "agent", id: "developer" },
      agentId: "developer",
      action: "github.create_pull_request",
      resource: { repository: "your-github-org/kygo" },
      parameters: {
        headBranch: "feature/x",
        baseBranch: "main",
        title: "Add feature",
        body: "body",
      },
      reason: "test",
    });
    expect(result.success).toBe(true);
    expect(result.externalId).toBe("123");
    expect(createPullRequest).toHaveBeenCalledOnce();
  });

  it("returns duplicate PR result without re-executing", async () => {
    const { execution, createPullRequest } = createExecution();
    const req = {
      requestId: "req-dup",
      projectId: "kygo",
      actor: { type: "agent" as const, id: "developer" },
      agentId: "developer",
      action: "github.create_pull_request" as const,
      resource: { repository: "your-github-org/kygo" },
      parameters: {
        headBranch: "feature/x",
        baseBranch: "main",
        title: "Add feature",
        body: "body",
      },
      reason: "test",
    };
    await execution.execute(req);
    const second = await execution.execute(req);
    expect(second.duplicate).toBe(true);
    expect(createPullRequest).toHaveBeenCalledOnce();
  });

  it("requires approval for jira.update_issue", async () => {
    const { execution, updateIssue } = createExecution();
    await expect(
      execution.execute({
        requestId: "req-jira-1",
        projectId: "kygo",
        actor: { type: "human", id: "manager" },
        action: "jira.update_issue",
        resource: { issueKey: "KYGO-1" },
        parameters: { fields: { comment: "hi" } },
        reason: "test",
      }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("executes jira.update_issue with approved request", async () => {
    const { execution, updateIssue, approvals } = createExecution();
    approvals.set("appr-1", {
      id: "appr-1",
      projectId: "kygo",
      action: "UPDATE_JIRA",
      status: "APPROVED",
    });
    const result = await execution.execute({
      requestId: "req-jira-2",
      projectId: "kygo",
      actor: { type: "human", id: "manager" },
      action: "jira.update_issue",
      resource: { issueKey: "KYGO-1" },
      parameters: { fields: { comment: "done" } },
      reason: "test",
      approvalRequestId: "appr-1",
    });
    expect(result.success).toBe(true);
    expect(updateIssue).toHaveBeenCalledOnce();
  });

  it("rejects fake approval=true without approvalRequestId", async () => {
    const { execution } = createExecution();
    await expect(
      execution.execute({
        requestId: "req-fake",
        projectId: "kygo",
        actor: { type: "human", id: "ai" },
        action: "jira.update_issue",
        resource: { issueKey: "KYGO-1" },
        parameters: { fields: { comment: "x" }, approval: true },
        reason: "test",
      }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
  });

  it("denies disabled merge and deploy", async () => {
    const { execution } = createExecution();
    await expect(
      execution.execute({
        requestId: "req-merge",
        projectId: "kygo",
        actor: { type: "human", id: "u" },
        action: "github.merge_pull_request",
        resource: { repository: "your-github-org/kygo", pullRequestNumber: 1 },
        parameters: {},
        reason: "test",
      }),
    ).rejects.toThrow(/disabled/i);

    await expect(
      execution.execute({
        requestId: "req-deploy",
        projectId: "kygo",
        actor: { type: "human", id: "u" },
        action: "deploy.production",
        resource: {},
        parameters: {},
        reason: "test",
      }),
    ).rejects.toThrow(/disabled/i);
  });

  it("rejects unauthorized agent", async () => {
    const { execution } = createExecution();
    await expect(
      execution.execute({
        requestId: "req-agent",
        projectId: "kygo",
        actor: { type: "agent", id: "reviewer" },
        agentId: "reviewer",
        action: "github.create_branch",
        resource: { repository: "your-github-org/kygo" },
        parameters: { branchName: "feature/x", baseBranch: "main" },
        reason: "test",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedAgentError);
  });

  it("supports dry-run without calling external APIs", async () => {
    const { execution, createBranch } = createExecution();
    const result = await execution.execute({
      requestId: "req-dry",
      projectId: "kygo",
      actor: { type: "agent", id: "developer" },
      agentId: "developer",
      action: "github.create_branch",
      resource: { repository: "your-github-org/kygo" },
      parameters: { branchName: "feature/dry", baseBranch: "main" },
      reason: "test",
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.success).toBe(true);
    expect(createBranch).not.toHaveBeenCalled();
  });

  it("rejects credentials in parameters", async () => {
    const { execution } = createExecution();
    await expect(
      execution.execute({
        requestId: "req-secret",
        projectId: "kygo",
        actor: { type: "human", id: "u" },
        action: "github.create_branch",
        resource: { repository: "your-github-org/kygo" },
        parameters: {
          branchName: "feature/x",
          baseBranch: "main",
          accessToken: "secret",
        },
        reason: "test",
      }),
    ).rejects.toBeInstanceOf(InvalidParametersError);
  });

  it("rejects unsupported jira fields", async () => {
    const { execution, approvals } = createExecution();
    approvals.set("appr-2", {
      id: "appr-2",
      projectId: "kygo",
      action: "UPDATE_JIRA",
      status: "APPROVED",
    });
    await expect(
      execution.execute({
        requestId: "req-fields",
        projectId: "kygo",
        actor: { type: "human", id: "u" },
        action: "jira.update_issue",
        resource: { issueKey: "KYGO-1" },
        parameters: { fields: { assignee: "bob" } },
        reason: "test",
        approvalRequestId: "appr-2",
      }),
    ).rejects.toBeInstanceOf(InvalidParametersError);
  });

  it("formats slack messages without executing", () => {
    expect(slackMessagePrCreated(123)).toContain("PR #123");
    expect(slackMessageJiraApprovalRequired("KYGO-9")).toContain("KYGO-9");
    expect(slackMessageDisabledAction("github.merge_pull_request")).toMatch(/disabled/i);
  });
});
