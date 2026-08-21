import type {
  CompactBranch,
  CompactCheck,
  CompactChecksResult,
  CompactCommitDetail,
  CompactCommitFile,
  CompactCommitSummary,
  CompactContributor,
  CompactFileContent,
  CompactPullRequestDetail,
  CompactPullRequestSummary,
  CompactRepositoryDetail,
  CompactRepositorySummary,
  CompactReview,
  GitHubBranchApi,
  GitHubCheckRunApi,
  GitHubCommitApi,
  GitHubCommitFileApi,
  GitHubContentApi,
  GitHubContributorApi,
  GitHubPullRequestApi,
  GitHubRepoApi,
  GitHubReviewApi,
} from "./github.types.js";

const MAX_BODY_LENGTH = 4000;

function truncate(value: string, max = MAX_BODY_LENGTH): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

export function mapRepositorySummary(repo: GitHubRepoApi): CompactRepositorySummary {
  const result: CompactRepositorySummary = {
    name: repo.name,
    fullName: repo.full_name,
    private: repo.private,
  };
  if (repo.description) {
    result.description = truncate(repo.description, 500);
  }
  if (repo.default_branch) {
    result.defaultBranch = repo.default_branch;
  }
  if (repo.language) {
    result.language = repo.language;
  }
  if (repo.html_url) {
    result.url = repo.html_url;
  }
  if (repo.created_at) {
    result.createdAt = repo.created_at;
  }
  if (repo.updated_at) {
    result.updatedAt = repo.updated_at;
  }
  return result;
}

export function mapRepositoryDetail(
  projectId: string,
  repo: GitHubRepoApi,
  languages?: Record<string, number>,
): CompactRepositoryDetail {
  const base = mapRepositorySummary(repo);
  const result: CompactRepositoryDetail = {
    ...base,
    projectId,
  };
  if (typeof repo.open_issues_count === "number") {
    result.openIssuesCount = repo.open_issues_count;
  }
  if (languages && Object.keys(languages).length > 0) {
    result.languages = languages;
  }
  return result;
}

export function mapBranch(branch: GitHubBranchApi): CompactBranch {
  return {
    name: branch.name,
    sha: branch.commit?.sha ?? "",
    protected: Boolean(branch.protected),
  };
}

export function mapCommitSummary(commit: GitHubCommitApi): CompactCommitSummary {
  const result: CompactCommitSummary = {
    sha: commit.sha,
    message: truncate(commit.commit?.message?.split("\n")[0] ?? "", 500),
  };
  if (commit.commit?.author?.name) {
    result.author = commit.commit.author.name;
  }
  if (commit.author?.login) {
    result.authorLogin = commit.author.login;
  }
  if (commit.commit?.author?.date) {
    result.committedAt = commit.commit.author.date;
  }
  if (commit.html_url) {
    result.url = commit.html_url;
  }
  return result;
}

function mapCommitFile(file: GitHubCommitFileApi): CompactCommitFile | null {
  if (!file.filename) {
    return null;
  }
  const mapped: CompactCommitFile = { filename: file.filename };
  if (file.status) {
    mapped.status = file.status;
  }
  if (typeof file.additions === "number") {
    mapped.additions = file.additions;
  }
  if (typeof file.deletions === "number") {
    mapped.deletions = file.deletions;
  }
  if (typeof file.changes === "number") {
    mapped.changes = file.changes;
  }
  return mapped;
}

export function mapCommitDetail(commit: GitHubCommitApi): CompactCommitDetail {
  const base = mapCommitSummary(commit);
  const files = (commit.files ?? [])
    .map(mapCommitFile)
    .filter((file): file is CompactCommitFile => file !== null);

  const result: CompactCommitDetail = {
    ...base,
    files,
  };
  if (typeof commit.stats?.additions === "number") {
    result.additions = commit.stats.additions;
  }
  if (typeof commit.stats?.deletions === "number") {
    result.deletions = commit.stats.deletions;
  }
  result.changedFiles = files.length;
  return result;
}

export function mapPullRequestSummary(pr: GitHubPullRequestApi): CompactPullRequestSummary {
  const result: CompactPullRequestSummary = {
    number: pr.number,
    title: truncate(pr.title, 300),
    state: pr.state,
    draft: Boolean(pr.draft),
  };
  if (pr.user?.login) {
    result.author = pr.user.login;
  }
  if (pr.head?.ref) {
    result.sourceBranch = pr.head.ref;
  }
  if (pr.base?.ref) {
    result.targetBranch = pr.base.ref;
  }
  if (pr.created_at) {
    result.createdAt = pr.created_at;
  }
  if (pr.updated_at) {
    result.updatedAt = pr.updated_at;
  }
  if (pr.merged_at) {
    result.mergedAt = pr.merged_at;
  }
  if (pr.html_url) {
    result.url = pr.html_url;
  }
  return result;
}

export function mapPullRequestDetail(pr: GitHubPullRequestApi): CompactPullRequestDetail {
  const base = mapPullRequestSummary(pr);
  const result: CompactPullRequestDetail = {
    ...base,
    merged: Boolean(pr.merged),
  };
  if (pr.body) {
    result.body = truncate(pr.body);
  }
  if (typeof pr.additions === "number") {
    result.additions = pr.additions;
  }
  if (typeof pr.deletions === "number") {
    result.deletions = pr.deletions;
  }
  if (typeof pr.changed_files === "number") {
    result.changedFiles = pr.changed_files;
  }
  return result;
}

export function mapReview(review: GitHubReviewApi): CompactReview {
  const result: CompactReview = { id: review.id };
  if (review.user?.login) {
    result.reviewer = review.user.login;
  }
  if (review.state) {
    result.state = review.state;
  }
  if (review.submitted_at) {
    result.submittedAt = review.submitted_at;
  }
  if (review.body) {
    result.body = truncate(review.body, 1000);
  }
  return result;
}

export function mapCheck(check: GitHubCheckRunApi): CompactCheck {
  const result: CompactCheck = {
    name: check.name ?? "unknown",
  };
  if (check.status) {
    result.status = check.status;
  }
  if (check.conclusion) {
    result.conclusion = check.conclusion;
  }
  if (check.started_at) {
    result.startedAt = check.started_at;
  }
  if (check.completed_at) {
    result.completedAt = check.completed_at;
  }
  const detailsUrl = check.details_url ?? check.html_url;
  if (detailsUrl) {
    result.detailsUrl = detailsUrl;
  }
  return result;
}

export function mapChecksResult(checks: GitHubCheckRunApi[]): CompactChecksResult {
  const mapped = checks.map(mapCheck);
  const allCompleted = mapped.every((check) => check.status === "completed");
  const anyFailure = mapped.some(
    (check) =>
      check.conclusion === "failure" ||
      check.conclusion === "timed_out" ||
      check.conclusion === "cancelled" ||
      check.conclusion === "action_required",
  );
  const anyNeutral = mapped.some(
    (check) => check.conclusion === "neutral" || check.conclusion === "skipped",
  );

  let status = "pending";
  let conclusion: string | undefined;

  if (mapped.length === 0) {
    status = "neutral";
    conclusion = "neutral";
  } else if (!allCompleted) {
    status = "in_progress";
  } else {
    status = "completed";
    if (anyFailure) {
      conclusion = "failure";
    } else if (anyNeutral && mapped.every((c) => c.conclusion !== "success")) {
      conclusion = "neutral";
    } else {
      conclusion = "success";
    }
  }

  const result: CompactChecksResult = { status, checks: mapped };
  if (conclusion) {
    result.conclusion = conclusion;
  }
  return result;
}

export function mapFileContent(content: GitHubContentApi, decoded: string): CompactFileContent {
  const result: CompactFileContent = {
    path: content.path ?? content.name ?? "",
    sha: content.sha ?? "",
    size: content.size ?? Buffer.byteLength(decoded, "utf8"),
    content: decoded,
    encoding: "utf-8",
  };
  if (content.html_url) {
    result.url = content.html_url;
  }
  return result;
}

export function mapContributor(contributor: GitHubContributorApi): CompactContributor | null {
  if (!contributor.login) {
    return null;
  }
  const result: CompactContributor = {
    login: contributor.login,
    contributions: contributor.contributions ?? 0,
  };
  if (contributor.avatar_url) {
    result.avatarUrl = contributor.avatar_url;
  }
  return result;
}
