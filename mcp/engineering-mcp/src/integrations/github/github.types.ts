/**
 * Partial GitHub REST API shapes and compact domain models for MCP.
 */

export interface GitHubUserApi {
  login?: string;
  id?: number;
  avatar_url?: string;
  html_url?: string;
}

export interface GitHubRepoApi {
  name: string;
  full_name: string;
  description?: string | null;
  private: boolean;
  default_branch?: string;
  language?: string | null;
  html_url?: string;
  open_issues_count?: number;
  created_at?: string;
  updated_at?: string;
  owner?: GitHubUserApi;
}

export interface GitHubBranchApi {
  name: string;
  commit?: { sha?: string; url?: string };
  protected?: boolean;
}

export interface GitHubCommitApi {
  sha: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: { name?: string; email?: string; date?: string };
    committer?: { name?: string; email?: string; date?: string };
  };
  author?: GitHubUserApi | null;
  stats?: { additions?: number; deletions?: number; total?: number };
  files?: GitHubCommitFileApi[];
}

export interface GitHubCommitFileApi {
  filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  patch?: string;
}

export interface GitHubPullRequestApi {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  draft?: boolean;
  merged?: boolean;
  merged_at?: string | null;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
  user?: GitHubUserApi | null;
  head?: { ref?: string; sha?: string };
  base?: { ref?: string; sha?: string };
  additions?: number;
  deletions?: number;
  changed_files?: number;
}

export interface GitHubReviewApi {
  id: number;
  user?: GitHubUserApi | null;
  state?: string;
  body?: string | null;
  submitted_at?: string | null;
}

export interface GitHubCheckRunApi {
  id?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  html_url?: string | null;
  details_url?: string | null;
}

export interface GitHubCheckRunsResponse {
  total_count?: number;
  check_runs?: GitHubCheckRunApi[];
}

export interface GitHubContentApi {
  type?: string;
  encoding?: string;
  size?: number;
  name?: string;
  path?: string;
  content?: string;
  sha?: string;
  html_url?: string | null;
  download_url?: string | null;
}

export interface GitHubContributorApi {
  login?: string;
  contributions?: number;
  avatar_url?: string;
  html_url?: string;
}

/** Compact domain models */

export interface CompactRepositorySummary {
  name: string;
  fullName: string;
  description?: string;
  private: boolean;
  defaultBranch?: string;
  language?: string;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CompactRepositoryDetail extends CompactRepositorySummary {
  projectId: string;
  languages?: Record<string, number>;
  openIssuesCount?: number;
}

export interface CompactBranch {
  name: string;
  sha: string;
  protected: boolean;
  aheadBy?: number;
  behindBy?: number;
}

export interface CompactCommitSummary {
  sha: string;
  message: string;
  author?: string;
  authorLogin?: string;
  committedAt?: string;
  url?: string;
}

export interface CompactCommitFile {
  filename: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
}

export interface CompactCommitDetail extends CompactCommitSummary {
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  files: CompactCommitFile[];
}

export interface CompactPullRequestSummary {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  author?: string;
  sourceBranch?: string;
  targetBranch?: string;
  createdAt?: string;
  updatedAt?: string;
  mergedAt?: string;
  url?: string;
}

export interface CompactPullRequestDetail extends CompactPullRequestSummary {
  body?: string;
  merged: boolean;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
}

export interface CompactReview {
  id: number;
  reviewer?: string;
  state?: string;
  submittedAt?: string;
  body?: string;
}

export interface CompactCheck {
  name: string;
  status?: string;
  conclusion?: string;
  startedAt?: string;
  completedAt?: string;
  detailsUrl?: string;
}

export interface CompactChecksResult {
  status: string;
  conclusion?: string;
  checks: CompactCheck[];
}

export interface CompactFileContent {
  path: string;
  sha: string;
  size: number;
  content: string;
  encoding: string;
  url?: string;
}

export interface CompactContributor {
  login: string;
  contributions: number;
  avatarUrl?: string;
}

export interface PaginationMeta {
  page: number;
  perPage: number;
}
