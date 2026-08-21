/**
 * GitHub write operations (controlled). Never force-push, merge, or delete.
 */

export interface CreateBranchInput {
  owner: string;
  repo: string;
  branchName: string;
  baseSha: string;
}

export interface CreatePullRequestInput {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
}

export interface GitHubWriteClient {
  get<T>(path: string): Promise<T>;
  request<T>(
    path: string,
    options: { method: "POST" | "GET"; body?: unknown },
  ): Promise<T>;
}

export async function githubCreateBranch(
  client: GitHubWriteClient,
  input: CreateBranchInput,
): Promise<{ ref: string; sha: string }> {
  const ref = `refs/heads/${input.branchName}`;
  const created = await client.request<{ ref: string; object: { sha: string } }>(
    `/repos/${input.owner}/${input.repo}/git/refs`,
    {
      method: "POST",
      body: {
        ref,
        sha: input.baseSha,
      },
    },
  );
  return { ref: created.ref, sha: created.object.sha };
}

export async function githubCreatePullRequest(
  client: GitHubWriteClient,
  input: CreatePullRequestInput,
): Promise<{ number: number; html_url: string; title: string }> {
  return client.request(`/repos/${input.owner}/${input.repo}/pulls`, {
    method: "POST",
    body: {
      title: input.title,
      body: input.body,
      head: input.head,
      base: input.base,
    },
  });
}

export async function githubGetBranchSha(
  client: GitHubWriteClient,
  owner: string,
  repo: string,
  branch: string,
): Promise<string> {
  const data = await client.get<{ commit: { sha: string } }>(
    `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`,
  );
  return data.commit.sha;
}
