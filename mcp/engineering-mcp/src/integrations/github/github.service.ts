import {
  ProjectConfigMissingError,
  ProjectNotFoundError,
  type GithubConfig,
  type ProjectConfigService,
} from "engineering-platform/config";
import { McpProjectNotFoundError } from "../../errors/mcp-errors.js";
import { GitHubClient } from "./github.client.js";
import {
  GitHubBinaryContentError,
  GitHubConfigurationError,
  GitHubFileTooLargeError,
  GitHubRepositoryBoundaryError,
  GitHubValidationError,
} from "./github.errors.js";
import {
  mapBranch,
  mapChecksResult,
  mapCommitDetail,
  mapCommitSummary,
  mapContributor,
  mapFileContent,
  mapPullRequestDetail,
  mapPullRequestSummary,
  mapRepositoryDetail,
  mapRepositorySummary,
  mapReview,
} from "./github.mapper.js";
import {
  githubCreateBranch,
  githubCreatePullRequest,
  githubGetBranchSha,
} from "./github.write.js";
import type {
  CompactBranch,
  CompactChecksResult,
  CompactCommitDetail,
  CompactCommitSummary,
  CompactContributor,
  CompactFileContent,
  CompactPullRequestDetail,
  CompactPullRequestSummary,
  CompactRepositoryDetail,
  CompactRepositorySummary,
  CompactReview,
  GitHubBranchApi,
  GitHubCheckRunsResponse,
  GitHubCommitApi,
  GitHubContentApi,
  GitHubContributorApi,
  GitHubPullRequestApi,
  GitHubRepoApi,
  GitHubReviewApi,
  PaginationMeta,
} from "./github.types.js";

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;
const DEFAULT_MAX_FILE_BYTES = 100 * 1024;

export interface GitHubServiceOptions {
  projectConfigService: ProjectConfigService;
  client?: GitHubClient | null;
  maxFileBytes?: number;
}

export interface ListOptions {
  page?: number;
  perPage?: number;
}

export interface ListCommitsOptions extends ListOptions {
  branch?: string;
  author?: string;
  since?: string;
  until?: string;
}

export interface ListPullRequestsOptions extends ListOptions {
  state?: "open" | "closed" | "all";
  head?: string;
  base?: string;
  author?: string;
}

/**
 * Project-agnostic GitHub read operations.
 * Repository access is constrained by ProjectConfigService allowlists.
 */
export class GitHubService {
  private readonly projectConfigService: ProjectConfigService;
  private readonly client: GitHubClient | null;
  private readonly maxFileBytes: number;

  constructor(options: GitHubServiceOptions) {
    this.projectConfigService = options.projectConfigService;
    this.client = options.client ?? null;
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async getRepositories(projectId: string): Promise<{
    projectId: string;
    repositories: CompactRepositorySummary[];
  }> {
    const client = this.requireClient();
    const github = this.resolveGithubConfig(projectId);
    const repositories: CompactRepositorySummary[] = [];

    for (const repository of github.repositories) {
      const repo = await client.get<GitHubRepoApi>(
        `/repos/${encodeURIComponent(github.organization)}/${encodeURIComponent(repository)}`,
      );
      repositories.push(mapRepositorySummary(repo));
    }

    return { projectId, repositories };
  }

  async getRepository(
    projectId: string,
    repository: string,
  ): Promise<CompactRepositoryDetail> {
    const client = this.requireClient();
    const { organization } = this.assertRepositoryAllowed(projectId, repository);

    const repo = await client.get<GitHubRepoApi>(
      `/repos/${encodeURIComponent(organization)}/${encodeURIComponent(repository)}`,
    );

    let languages: Record<string, number> | undefined;
    try {
      languages = await client.get<Record<string, number>>(
        `/repos/${encodeURIComponent(organization)}/${encodeURIComponent(repository)}/languages`,
      );
    } catch {
      languages = undefined;
    }

    return mapRepositoryDetail(projectId, repo, languages);
  }

  async listBranches(
    projectId: string,
    repository: string,
    options: ListOptions = {},
  ): Promise<{ repository: string; branches: CompactBranch[]; pagination: PaginationMeta }> {
    const client = this.requireClient();
    const { organization } = this.assertRepositoryAllowed(projectId, repository);
    const pagination = normalizePagination(options);

    const branches = await client.get<GitHubBranchApi[]>(
      `/repos/${encodeURIComponent(organization)}/${encodeURIComponent(repository)}/branches`,
      { page: pagination.page, per_page: pagination.perPage },
    );

    return {
      repository,
      branches: branches.map(mapBranch),
      pagination,
    };
  }

  async getBranch(
    projectId: string,
    repository: string,
    branch: string,
  ): Promise<CompactBranch> {
    const client = this.requireClient();
    const { organization } = this.assertRepositoryAllowed(projectId, repository);

    const result = await client.get<GitHubBranchApi>(
      `/repos/${encodeURIComponent(organization)}/${encodeURIComponent(repository)}/branches/${encodeURIComponent(branch)}`,
    );

    return mapBranch(result);
  }

  async listCommits(
    projectId: string,
    repository: string,
    options: ListCommitsOptions = {},
  ): Promise<{ commits: CompactCommitSummary[]; pagination: PaginationMeta }> {
    const client = this.requireClient();
    const { organization } = this.assertRepositoryAllowed(projectId, repository);
    const pagination = normalizePagination(options);

    const commits = await client.get<GitHubCommitApi[]>(
      `/repos/${encodeURIComponent(organization)}/${encodeURIComponent(repository)}/commits`,
      {
        page: pagination.page,
        per_page: pagination.perPage,
        ...(options.branch !== undefined ? { sha: options.branch } : {}),
        ...(options.author !== undefined ? { author: options.author } : {}),
        ...(options.since !== undefined ? { since: options.since } : {}),
        ...(options.until !== undefined ? { until: options.until } : {}),
      },
    );

    return {
      commits: commits.map(mapCommitSummary),
      pagination,
    };
  }

  async getCommit(
    projectId: string,
    repository: string,
    sha: string,
  ): Promise<CompactCommitDetail> {
    const client = this.requireClient();
    const { organization } = this.assertRepositoryAllowed(projectId, repository);

    const commit = await client.get<GitHubCommitApi>(
      `/repos/${encodeURIComponent(organization)}/${encodeURIComponent(repository)}/commits/${encodeURIComponent(sha)}`,
    );

    return mapCommitDetail(commit);
  }

  async listPullRequests(
    projectId: string,
    repository: string,
    options: ListPullRequestsOptions = {},
  ): Promise<{ pullRequests: CompactPullRequestSummary[]; pagination: PaginationMeta }> {
    const client = this.requireClient();
    const { organization } = this.assertRepositoryAllowed(projectId, repository);
    const pagination = normalizePagination(options);

    const pullRequests = await client.get<GitHubPullRequestApi[]>(
      `/repos/${encodeURIComponent(organization)}/${encodeURIComponent(repository)}/pulls`,
      {
        page: pagination.page,
        per_page: pagination.perPage,
        state: options.state ?? "open",
        ...(options.head !== undefined ? { head: options.head } : {}),
        ...(options.base !== undefined ? { base: options.base } : {}),
      },
    );

    const filtered =
      options.author !== undefined
        ? pullRequests.filter((pr) => pr.user?.login === options.author)
        : pullRequests;

    return {
      pullRequests: filtered.map(mapPullRequestSummary),
      pagination,
    };
  }

  async getPullRequest(
    projectId: string,
    repository: string,
    pullRequestNumber: number,
  ): Promise<CompactPullRequestDetail> {
    const client = this.requireClient();
    const { organization } = this.assertRepositoryAllowed(projectId, repository);
    assertPositiveInt(pullRequestNumber, "pullRequestNumber");

    const pr = await client.get<GitHubPullRequestApi>(
      `/repos/${encodeURIComponent(organization)}/${encodeURIComponent(repository)}/pulls/${encodeURIComponent(String(pullRequestNumber))}`,
    );

    return mapPullRequestDetail(pr);
  }

  async listPullRequestReviews(
    projectId: string,
    repository: string,
    pullRequestNumber: number,
  ): Promise<{ reviews: CompactReview[] }> {
    const client = this.requireClient();
    const { organization } = this.assertRepositoryAllowed(projectId, repository);
    assertPositiveInt(pullRequestNumber, "pullRequestNumber");

    const reviews = await client.get<GitHubReviewApi[]>(
      `/repos/${encodeURIComponent(organization)}/${encodeURIComponent(repository)}/pulls/${encodeURIComponent(String(pullRequestNumber))}/reviews`,
    );

    return { reviews: reviews.map(mapReview) };
  }

  async getPullRequestChecks(
    projectId: string,
    repository: string,
    pullRequestNumber: number,
  ): Promise<CompactChecksResult> {
    const client = this.requireClient();
    const { organization } = this.assertRepositoryAllowed(projectId, repository);
    assertPositiveInt(pullRequestNumber, "pullRequestNumber");

    const pr = await client.get<GitHubPullRequestApi>(
      `/repos/${encodeURIComponent(organization)}/${encodeURIComponent(repository)}/pulls/${encodeURIComponent(String(pullRequestNumber))}`,
    );

    const sha = pr.head?.sha;
    if (!sha) {
      return { status: "neutral", conclusion: "neutral", checks: [] };
    }

    const checkRuns = await client.get<GitHubCheckRunsResponse>(
      `/repos/${encodeURIComponent(organization)}/${encodeURIComponent(repository)}/commits/${encodeURIComponent(sha)}/check-runs`,
      { per_page: 100 },
    );

    return mapChecksResult(checkRuns.check_runs ?? []);
  }

  async getFile(
    projectId: string,
    repository: string,
    path: string,
    ref?: string,
  ): Promise<CompactFileContent> {
    const client = this.requireClient();
    const { organization } = this.assertRepositoryAllowed(projectId, repository);

    if (!path.trim()) {
      throw new GitHubValidationError("path is required");
    }

    const content = await client.get<GitHubContentApi>(
      `/repos/${encodeURIComponent(organization)}/${encodeURIComponent(repository)}/contents/${path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
      {
        ...(ref !== undefined ? { ref } : {}),
      },
    );

    if (Array.isArray(content) || content.type === "dir") {
      throw new GitHubValidationError(`Path "${path}" is a directory, not a file`);
    }

    const size = content.size ?? 0;
    if (size > this.maxFileBytes) {
      throw new GitHubFileTooLargeError(
        `File "${path}" is ${size} bytes which exceeds the ${this.maxFileBytes} byte limit.`,
        { details: { path, size, maxFileBytes: this.maxFileBytes } },
      );
    }

    if (content.encoding !== "base64" || typeof content.content !== "string") {
      throw new GitHubBinaryContentError(
        `File "${path}" content is not available as text.`,
        { details: { path, encoding: content.encoding } },
      );
    }

    const decoded = Buffer.from(content.content.replace(/\n/g, ""), "base64").toString("utf8");
    if (decoded.includes("\u0000")) {
      throw new GitHubBinaryContentError(`File "${path}" appears to be binary content.`);
    }

    return mapFileContent(content, decoded);
  }

  async getContributors(
    projectId: string,
    repository: string,
    options: ListOptions = {},
  ): Promise<{ contributors: CompactContributor[]; pagination: PaginationMeta }> {
    const client = this.requireClient();
    const { organization } = this.assertRepositoryAllowed(projectId, repository);
    const pagination = normalizePagination(options);

    const contributors = await client.get<GitHubContributorApi[]>(
      `/repos/${encodeURIComponent(organization)}/${encodeURIComponent(repository)}/contributors`,
      { page: pagination.page, per_page: pagination.perPage },
    );

    return {
      contributors: contributors
        .map(mapContributor)
        .filter((item): item is CompactContributor => item !== null),
      pagination,
    };
  }

  /**
   * Controlled write: create a branch from a base branch tip.
   * Does not force-push, delete, or overwrite protected branches.
   */
  async createBranch(
    projectId: string,
    input: { branchName: string; baseBranch: string; repository?: string },
  ): Promise<{ repository: string; ref: string; sha: string }> {
    const client = this.requireClient();
    const github = this.resolveGithubConfig(projectId);
    const repoShort = input.repository ?? github.repositories[0];
    if (!repoShort) {
      throw new GitHubConfigurationError(
        `Project "${projectId}" has no configured GitHub repositories.`,
      );
    }
    const { organization, repository } = this.assertRepositoryAllowed(
      projectId,
      repoShort.includes("/") ? repoShort.split("/").pop()! : repoShort,
    );

    const baseSha = await githubGetBranchSha(
      client,
      organization,
      repository,
      input.baseBranch,
    );
    const created = await githubCreateBranch(client, {
      owner: organization,
      repo: repository,
      branchName: input.branchName,
      baseSha,
    });

    return {
      repository: `${organization}/${repository}`,
      ref: created.ref,
      sha: created.sha,
    };
  }

  /**
   * Controlled write: open a pull request. Does not merge or close.
   */
  async createPullRequest(
    projectId: string,
    input: {
      headBranch: string;
      baseBranch: string;
      title: string;
      body: string;
      repository?: string;
    },
  ): Promise<{
    repository: string;
    number: number;
    htmlUrl: string;
    title: string;
  }> {
    const client = this.requireClient();
    const github = this.resolveGithubConfig(projectId);
    const repoShort = input.repository ?? github.repositories[0];
    if (!repoShort) {
      throw new GitHubConfigurationError(
        `Project "${projectId}" has no configured GitHub repositories.`,
      );
    }
    const { organization, repository } = this.assertRepositoryAllowed(
      projectId,
      repoShort.includes("/") ? repoShort.split("/").pop()! : repoShort,
    );

    // Ensure branches exist (boundary + existence)
    await this.getBranch(projectId, repository, input.headBranch);
    await this.getBranch(projectId, repository, input.baseBranch);

    const pr = await githubCreatePullRequest(client, {
      owner: organization,
      repo: repository,
      title: input.title,
      body: input.body,
      head: input.headBranch,
      base: input.baseBranch,
    });

    return {
      repository: `${organization}/${repository}`,
      number: pr.number,
      htmlUrl: pr.html_url,
      title: pr.title,
    };
  }

  private assertRepositoryAllowed(
    projectId: string,
    repository: string,
  ): { organization: string; repository: string } {
    const github = this.resolveGithubConfig(projectId);
    const allowed = github.repositories.some(
      (name) => name.toLowerCase() === repository.toLowerCase(),
    );

    if (!allowed) {
      throw new GitHubRepositoryBoundaryError(
        `Repository ${repository} is not configured for project ${projectId}.`,
        {
          details: {
            projectId,
            repository,
            allowedRepositories: github.repositories,
          },
        },
      );
    }

    return { organization: github.organization, repository };
  }

  private resolveGithubConfig(projectId: string): GithubConfig {
    try {
      return this.projectConfigService.getGithubConfig(projectId);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new McpProjectNotFoundError(projectId, { cause: error });
      }
      if (error instanceof ProjectConfigMissingError) {
        throw new GitHubConfigurationError(
          `Project "${projectId}" does not define github configuration.`,
          { cause: error, details: { projectId } },
        );
      }
      throw error;
    }
  }

  private requireClient(): GitHubClient {
    if (!this.client) {
      throw new GitHubConfigurationError(
        "GitHub is not configured. Set GITHUB_TOKEN (and optionally GITHUB_API_URL).",
      );
    }
    return this.client;
  }
}

function normalizePagination(options: ListOptions): PaginationMeta {
  const page = options.page ?? 1;
  const perPage = options.perPage ?? DEFAULT_PER_PAGE;

  if (!Number.isInteger(page) || page < 1) {
    throw new GitHubValidationError("page must be a positive integer");
  }
  if (!Number.isInteger(perPage) || perPage < 1) {
    throw new GitHubValidationError("perPage must be a positive integer");
  }
  if (perPage > MAX_PER_PAGE) {
    throw new GitHubValidationError(`perPage must be <= ${MAX_PER_PAGE}`);
  }

  return { page, perPage };
}

function assertPositiveInt(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new GitHubValidationError(`${field} must be a positive integer`);
  }
}

export function createGitHubClientFromEnv(env: {
  GITHUB_TOKEN?: string;
  GITHUB_API_URL?: string;
  GITHUB_REQUEST_TIMEOUT_MS?: number;
}): GitHubClient | null {
  const token = env.GITHUB_TOKEN?.trim();
  if (!token) {
    return null;
  }

  return new GitHubClient({
    token,
    ...(env.GITHUB_API_URL !== undefined ? { apiUrl: env.GITHUB_API_URL } : {}),
    timeoutMs: env.GITHUB_REQUEST_TIMEOUT_MS ?? 10_000,
  });
}
