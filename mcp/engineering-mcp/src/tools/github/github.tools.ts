import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { GitHubError } from "../../integrations/github/github.errors.js";
import type { GitHubService } from "../../integrations/github/github.service.js";
import type { EngineeringTool } from "../types.js";
import type { ToolContext } from "../tool-context.js";

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function requireGitHub(context: ToolContext): GitHubService {
  if (!context.github) {
    throw new GitHubError("GitHub service is unavailable in this runtime.", {
      code: "GITHUB_CONFIGURATION_ERROR",
    });
  }
  return context.github;
}

function withReadPermission(tool: EngineeringTool): EngineeringTool {
  return {
    ...tool,
    execute: async (context, input) => {
      context.permissions.assertAllowed("READ");
      return tool.execute(context, input);
    },
  };
}

const projectIdSchema = z.string().trim().min(1, "projectId is required");
const repositorySchema = z.string().trim().min(1, "repository is required");
const perPageSchema = z.number().int().min(1).max(100).optional().default(20);
const pageSchema = z.number().int().min(1).optional().default(1);

export function createGitHubTools(): EngineeringTool[] {
  return [
    withReadPermission({
      name: "github_list_repositories",
      description:
        "List GitHub repositories configured for a platform project. Only allowlisted repositories are returned.",
      inputSchema: z.object({ projectId: projectIdSchema }),
      execute: async (context, input) => {
        const { projectId } = z.object({ projectId: projectIdSchema }).parse(input);
        return jsonResult(await requireGitHub(context).getRepositories(projectId));
      },
    }),
    withReadPermission({
      name: "github_get_repository",
      description: "Get details for a GitHub repository configured for a platform project.",
      inputSchema: z.object({
        projectId: projectIdSchema,
        repository: repositorySchema,
      }),
      execute: async (context, input) => {
        const parsed = z
          .object({ projectId: projectIdSchema, repository: repositorySchema })
          .parse(input);
        return jsonResult(
          await requireGitHub(context).getRepository(parsed.projectId, parsed.repository),
        );
      },
    }),
    withReadPermission({
      name: "github_list_branches",
      description: "List branches for a project-scoped GitHub repository.",
      inputSchema: z.object({
        projectId: projectIdSchema,
        repository: repositorySchema,
        page: pageSchema,
        perPage: perPageSchema,
      }),
      execute: async (context, input) => {
        const parsed = z
          .object({
            projectId: projectIdSchema,
            repository: repositorySchema,
            page: pageSchema,
            perPage: perPageSchema,
          })
          .parse(input);
        return jsonResult(
          await requireGitHub(context).listBranches(parsed.projectId, parsed.repository, {
            page: parsed.page,
            perPage: parsed.perPage,
          }),
        );
      },
    }),
    withReadPermission({
      name: "github_get_branch",
      description: "Get a branch for a project-scoped GitHub repository.",
      inputSchema: z.object({
        projectId: projectIdSchema,
        repository: repositorySchema,
        branch: z.string().trim().min(1),
      }),
      execute: async (context, input) => {
        const parsed = z
          .object({
            projectId: projectIdSchema,
            repository: repositorySchema,
            branch: z.string().trim().min(1),
          })
          .parse(input);
        return jsonResult(
          await requireGitHub(context).getBranch(
            parsed.projectId,
            parsed.repository,
            parsed.branch,
          ),
        );
      },
    }),
    withReadPermission({
      name: "github_list_commits",
      description: "List commits for a project-scoped GitHub repository.",
      inputSchema: z.object({
        projectId: projectIdSchema,
        repository: repositorySchema,
        branch: z.string().optional(),
        author: z.string().optional(),
        since: z.string().optional(),
        until: z.string().optional(),
        page: pageSchema,
        perPage: perPageSchema,
      }),
      execute: async (context, input) => {
        const parsed = z
          .object({
            projectId: projectIdSchema,
            repository: repositorySchema,
            branch: z.string().optional(),
            author: z.string().optional(),
            since: z.string().optional(),
            until: z.string().optional(),
            page: pageSchema,
            perPage: perPageSchema,
          })
          .parse(input);
        return jsonResult(
          await requireGitHub(context).listCommits(parsed.projectId, parsed.repository, {
            page: parsed.page,
            perPage: parsed.perPage,
            ...(parsed.branch !== undefined ? { branch: parsed.branch } : {}),
            ...(parsed.author !== undefined ? { author: parsed.author } : {}),
            ...(parsed.since !== undefined ? { since: parsed.since } : {}),
            ...(parsed.until !== undefined ? { until: parsed.until } : {}),
          }),
        );
      },
    }),
    withReadPermission({
      name: "github_get_commit",
      description: "Get a commit (without patch content) for a project-scoped repository.",
      inputSchema: z.object({
        projectId: projectIdSchema,
        repository: repositorySchema,
        sha: z.string().trim().min(1),
      }),
      execute: async (context, input) => {
        const parsed = z
          .object({
            projectId: projectIdSchema,
            repository: repositorySchema,
            sha: z.string().trim().min(1),
          })
          .parse(input);
        return jsonResult(
          await requireGitHub(context).getCommit(
            parsed.projectId,
            parsed.repository,
            parsed.sha,
          ),
        );
      },
    }),
    withReadPermission({
      name: "github_list_pull_requests",
      description: "List pull requests for a project-scoped GitHub repository.",
      inputSchema: z.object({
        projectId: projectIdSchema,
        repository: repositorySchema,
        state: z.enum(["open", "closed", "all"]).optional().default("open"),
        head: z.string().optional(),
        base: z.string().optional(),
        author: z.string().optional(),
        page: pageSchema,
        perPage: perPageSchema,
      }),
      execute: async (context, input) => {
        const parsed = z
          .object({
            projectId: projectIdSchema,
            repository: repositorySchema,
            state: z.enum(["open", "closed", "all"]).optional().default("open"),
            head: z.string().optional(),
            base: z.string().optional(),
            author: z.string().optional(),
            page: pageSchema,
            perPage: perPageSchema,
          })
          .parse(input);
        return jsonResult(
          await requireGitHub(context).listPullRequests(parsed.projectId, parsed.repository, {
            page: parsed.page,
            perPage: parsed.perPage,
            state: parsed.state,
            ...(parsed.head !== undefined ? { head: parsed.head } : {}),
            ...(parsed.base !== undefined ? { base: parsed.base } : {}),
            ...(parsed.author !== undefined ? { author: parsed.author } : {}),
          }),
        );
      },
    }),
    withReadPermission({
      name: "github_get_pull_request",
      description: "Get a pull request for a project-scoped GitHub repository.",
      inputSchema: z.object({
        projectId: projectIdSchema,
        repository: repositorySchema,
        pullRequestNumber: z.number().int().positive(),
      }),
      execute: async (context, input) => {
        const parsed = z
          .object({
            projectId: projectIdSchema,
            repository: repositorySchema,
            pullRequestNumber: z.number().int().positive(),
          })
          .parse(input);
        return jsonResult(
          await requireGitHub(context).getPullRequest(
            parsed.projectId,
            parsed.repository,
            parsed.pullRequestNumber,
          ),
        );
      },
    }),
    withReadPermission({
      name: "github_list_pull_request_reviews",
      description: "List reviews for a pull request in a project-scoped repository.",
      inputSchema: z.object({
        projectId: projectIdSchema,
        repository: repositorySchema,
        pullRequestNumber: z.number().int().positive(),
      }),
      execute: async (context, input) => {
        const parsed = z
          .object({
            projectId: projectIdSchema,
            repository: repositorySchema,
            pullRequestNumber: z.number().int().positive(),
          })
          .parse(input);
        return jsonResult(
          await requireGitHub(context).listPullRequestReviews(
            parsed.projectId,
            parsed.repository,
            parsed.pullRequestNumber,
          ),
        );
      },
    }),
    withReadPermission({
      name: "github_get_pull_request_checks",
      description:
        "Get CI/check-run status for a pull request head commit in a project-scoped repository.",
      inputSchema: z.object({
        projectId: projectIdSchema,
        repository: repositorySchema,
        pullRequestNumber: z.number().int().positive(),
      }),
      execute: async (context, input) => {
        const parsed = z
          .object({
            projectId: projectIdSchema,
            repository: repositorySchema,
            pullRequestNumber: z.number().int().positive(),
          })
          .parse(input);
        return jsonResult(
          await requireGitHub(context).getPullRequestChecks(
            parsed.projectId,
            parsed.repository,
            parsed.pullRequestNumber,
          ),
        );
      },
    }),
    withReadPermission({
      name: "github_get_file",
      description:
        "Get a text file from a project-scoped repository. Binary/large files are rejected.",
      inputSchema: z.object({
        projectId: projectIdSchema,
        repository: repositorySchema,
        path: z.string().trim().min(1),
        ref: z.string().optional(),
      }),
      execute: async (context, input) => {
        const parsed = z
          .object({
            projectId: projectIdSchema,
            repository: repositorySchema,
            path: z.string().trim().min(1),
            ref: z.string().optional(),
          })
          .parse(input);
        return jsonResult(
          await requireGitHub(context).getFile(
            parsed.projectId,
            parsed.repository,
            parsed.path,
            parsed.ref,
          ),
        );
      },
    }),
    withReadPermission({
      name: "github_list_contributors",
      description: "List contributors for a project-scoped GitHub repository.",
      inputSchema: z.object({
        projectId: projectIdSchema,
        repository: repositorySchema,
        page: pageSchema,
        perPage: perPageSchema,
      }),
      execute: async (context, input) => {
        const parsed = z
          .object({
            projectId: projectIdSchema,
            repository: repositorySchema,
            page: pageSchema,
            perPage: perPageSchema,
          })
          .parse(input);
        return jsonResult(
          await requireGitHub(context).getContributors(parsed.projectId, parsed.repository, {
            page: parsed.page,
            perPage: parsed.perPage,
          }),
        );
      },
    }),
  ];
}

export const GITHUB_TOOL_NAMES = [
  "github_list_repositories",
  "github_get_repository",
  "github_list_branches",
  "github_get_branch",
  "github_list_commits",
  "github_get_commit",
  "github_list_pull_requests",
  "github_get_pull_request",
  "github_list_pull_request_reviews",
  "github_get_pull_request_checks",
  "github_get_file",
  "github_list_contributors",
] as const;
