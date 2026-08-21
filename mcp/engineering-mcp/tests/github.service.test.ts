import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ProjectConfigLoader, ProjectConfigService } from "engineering-platform/config";
import { GitHubClient } from "../src/integrations/github/github.client.js";
import {
  GitHubBinaryContentError,
  GitHubConfigurationError,
  GitHubFileTooLargeError,
  GitHubRepositoryBoundaryError,
  GitHubValidationError,
} from "../src/integrations/github/github.errors.js";
import { GitHubService } from "../src/integrations/github/github.service.js";
import { createGitHubTools } from "../src/tools/github/index.js";
import { createToolContext } from "../src/tools/tool-context.js";
import { loadMcpEnv } from "../src/config/env.config.js";
import { PermissionService } from "../src/security/permission.service.js";
import { Logger } from "../src/services/logger.js";
import { ProjectContextService } from "../src/services/project-context.service.js";
import { McpPermissionError, McpProjectNotFoundError } from "../src/errors/mcp-errors.js";

const projectsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../projects",
);

function createProjectConfigService(): ProjectConfigService {
  return new ProjectConfigService({
    loader: new ProjectConfigLoader({ projectsDir }),
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockClient(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  return new GitHubClient({
    token: "token",
    maxRetries: 0,
    fetchImpl: async (input, init) => handler(String(input), init),
  });
}

describe("GitHubService", () => {
  it("lists Kygo repositories from project config", async () => {
    const client = mockClient(async (url) => {
      if (url.includes("/repos/your-github-org/kygo")) {
        return json(200, {
          name: "kygo",
          full_name: "your-github-org/kygo",
          private: true,
          default_branch: "main",
          language: "TypeScript",
          html_url: "https://github.com/your-github-org/kygo",
        });
      }
      return json(404, { message: "Not Found" });
    });

    const service = new GitHubService({
      projectConfigService: createProjectConfigService(),
      client,
    });

    const result = await service.getRepositories("kygo");
    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0]?.name).toBe("kygo");
  });

  it("lists ClubSync repositories from project config", async () => {
    const client = mockClient(async (url) => {
      if (url.includes("/repos/your-github-org/clubsync")) {
        return json(200, {
          name: "clubsync",
          full_name: "your-github-org/clubsync",
          private: false,
        });
      }
      return json(404, { message: "Not Found" });
    });

    const service = new GitHubService({
      projectConfigService: createProjectConfigService(),
      client,
    });

    const result = await service.getRepositories("clubsync");
    expect(result.repositories[0]?.name).toBe("clubsync");
  });

  it("allows Kygo → kygo repository", async () => {
    const client = mockClient(async (url) => {
      if (url.endsWith("/languages")) {
        return json(200, { TypeScript: 1000 });
      }
      return json(200, {
        name: "kygo",
        full_name: "your-github-org/kygo",
        private: true,
        open_issues_count: 3,
      });
    });

    const service = new GitHubService({
      projectConfigService: createProjectConfigService(),
      client,
    });

    const repo = await service.getRepository("kygo", "kygo");
    expect(repo.projectId).toBe("kygo");
    expect(repo.openIssuesCount).toBe(3);
  });

  it("rejects Kygo → clubsync repository", async () => {
    const service = new GitHubService({
      projectConfigService: createProjectConfigService(),
      client: mockClient(async () => json(200, {})),
    });
    await expect(service.getRepository("kygo", "clubsync")).rejects.toBeInstanceOf(
      GitHubRepositoryBoundaryError,
    );
  });

  it("rejects ClubSync → kygo repository", async () => {
    const service = new GitHubService({
      projectConfigService: createProjectConfigService(),
      client: mockClient(async () => json(200, {})),
    });
    await expect(service.getRepository("clubsync", "kygo")).rejects.toBeInstanceOf(
      GitHubRepositoryBoundaryError,
    );
  });

  it("rejects unknown project", async () => {
    const service = new GitHubService({
      projectConfigService: createProjectConfigService(),
      client: mockClient(async () => json(200, {})),
    });
    await expect(service.getRepositories("missing-project")).rejects.toBeInstanceOf(
      McpProjectNotFoundError,
    );
  });

  it("fails when GitHub is not configured", async () => {
    const service = new GitHubService({
      projectConfigService: createProjectConfigService(),
      client: null,
    });
    await expect(service.getRepositories("kygo")).rejects.toBeInstanceOf(
      GitHubConfigurationError,
    );
  });

  it("lists branches with pagination", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      expect(String(input)).toContain("per_page=20");
      expect(String(input)).toContain("page=1");
      return json(200, [{ name: "main", commit: { sha: "abc" }, protected: true }]);
    });
    const service = new GitHubService({
      projectConfigService: createProjectConfigService(),
      client: new GitHubClient({ token: "token", maxRetries: 0, fetchImpl }),
    });

    const result = await service.listBranches("kygo", "kygo", { page: 1, perPage: 20 });
    expect(result.branches[0]?.name).toBe("main");
    expect(result.pagination.perPage).toBe(20);
  });

  it("rejects invalid perPage", async () => {
    const service = new GitHubService({
      projectConfigService: createProjectConfigService(),
      client: mockClient(async () => json(200, [])),
    });
    await expect(
      service.listBranches("kygo", "kygo", { perPage: 101 }),
    ).rejects.toBeInstanceOf(GitHubValidationError);
  });

  it("gets branch, commit, PR, reviews, checks", async () => {
    const client = mockClient(async (url) => {
      if (url.includes("/branches/main")) {
        return json(200, { name: "main", commit: { sha: "abc" }, protected: false });
      }
      if (url.includes("/check-runs")) {
        return json(200, {
          check_runs: [{ name: "ci", status: "completed", conclusion: "success" }],
        });
      }
      if (url.includes("/commits/abc")) {
        return json(200, {
          sha: "abc",
          commit: { message: "hello", author: { name: "Ada", date: "2026-01-01T00:00:00Z" } },
          stats: { additions: 1, deletions: 0 },
          files: [{ filename: "a.ts", status: "added", additions: 1, deletions: 0, changes: 1 }],
        });
      }
      if (url.includes("/pulls/1/reviews")) {
        return json(200, [{ id: 9, user: { login: "rev" }, state: "APPROVED" }]);
      }
      if (url.includes("/pulls/1")) {
        return json(200, {
          number: 1,
          title: "PR",
          state: "open",
          draft: false,
          merged: false,
          head: { ref: "feature", sha: "abc" },
          base: { ref: "main" },
          user: { login: "dev" },
        });
      }
      if (url.includes("/pulls")) {
        return json(200, [
          {
            number: 1,
            title: "PR",
            state: "open",
            draft: false,
            head: { ref: "feature" },
            base: { ref: "main" },
            user: { login: "dev" },
          },
        ]);
      }
      if (url.includes("/commits")) {
        return json(200, [
          {
            sha: "abc",
            commit: { message: "hello", author: { name: "Ada", date: "2026-01-01T00:00:00Z" } },
          },
        ]);
      }
      return json(404, { message: "Not Found" });
    });

    const service = new GitHubService({
      projectConfigService: createProjectConfigService(),
      client,
    });

    expect((await service.getBranch("kygo", "kygo", "main")).sha).toBe("abc");
    expect((await service.listCommits("kygo", "kygo")).commits[0]?.sha).toBe("abc");
    expect((await service.getCommit("kygo", "kygo", "abc")).changedFiles).toBe(1);
    expect((await service.listPullRequests("kygo", "kygo")).pullRequests[0]?.number).toBe(1);
    expect((await service.getPullRequest("kygo", "kygo", 1)).number).toBe(1);
    expect((await service.listPullRequestReviews("kygo", "kygo", 1)).reviews[0]?.id).toBe(9);
    expect((await service.getPullRequestChecks("kygo", "kygo", 1)).conclusion).toBe("success");
  });

  it("returns file content and rejects large/binary files", async () => {
    const encoded = Buffer.from("hello world", "utf8").toString("base64");
    const client = mockClient(async (url) => {
      if (url.includes("large.ts")) {
        return json(200, {
          type: "file",
          encoding: "base64",
          size: 200000,
          path: "large.ts",
          sha: "1",
          content: encoded,
        });
      }
      if (url.includes("bin.dat")) {
        const binary = Buffer.from([0, 1, 2, 0, 3]).toString("base64");
        return json(200, {
          type: "file",
          encoding: "base64",
          size: 5,
          path: "bin.dat",
          sha: "2",
          content: binary,
        });
      }
      return json(200, {
        type: "file",
        encoding: "base64",
        size: 11,
        path: "readme.md",
        sha: "3",
        content: encoded,
        html_url: "https://github.com/your-github-org/kygo/blob/main/readme.md",
      });
    });

    const service = new GitHubService({
      projectConfigService: createProjectConfigService(),
      client,
      maxFileBytes: 1000,
    });

    const file = await service.getFile("kygo", "kygo", "readme.md");
    expect(file.content).toBe("hello world");
    await expect(service.getFile("kygo", "kygo", "large.ts")).rejects.toBeInstanceOf(
      GitHubFileTooLargeError,
    );
    await expect(service.getFile("kygo", "kygo", "bin.dat")).rejects.toBeInstanceOf(
      GitHubBinaryContentError,
    );
  });

  it("lists contributors", async () => {
    const service = new GitHubService({
      projectConfigService: createProjectConfigService(),
      client: mockClient(async () =>
        json(200, [{ login: "ada", contributions: 12, avatar_url: "https://example.com/a.png" }]),
      ),
    });
    const result = await service.getContributors("kygo", "kygo");
    expect(result.contributors[0]?.login).toBe("ada");
  });
});

describe("GitHub MCP tools permission", () => {
  it("allows READ when MCP_READ_ONLY=true", async () => {
    const tools = createGitHubTools();
    const list = tools.find((tool) => tool.name === "github_list_repositories");
    expect(list).toBeDefined();

    const github = new GitHubService({
      projectConfigService: createProjectConfigService(),
      client: mockClient(async () =>
        json(200, {
          name: "kygo",
          full_name: "your-github-org/kygo",
          private: true,
        }),
      ),
    });

    const context = createToolContext({
      config: loadMcpEnv({ MCP_READ_ONLY: "true" }),
      logger: new Logger({ level: "error", sink: () => undefined }),
      permissions: new PermissionService({ readOnly: true }),
      projects: ProjectContextService.createDefault(projectsDir),
      jira: null,
      github,
    });

    const result = await list!.execute(context, { projectId: "kygo" });
    expect(result.isError).toBeUndefined();
  });

  it("still blocks WRITE via permission layer", () => {
    const permissions = new PermissionService({ readOnly: true });
    expect(() => permissions.assertAllowed("WRITE")).toThrow(McpPermissionError);
  });
});
