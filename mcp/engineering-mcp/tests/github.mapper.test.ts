import { describe, expect, it } from "vitest";
import {
  mapBranch,
  mapChecksResult,
  mapCommitDetail,
  mapPullRequestSummary,
  mapRepositorySummary,
} from "../src/integrations/github/github.mapper.js";

describe("GitHubMapper", () => {
  it("maps repository summary", () => {
    expect(
      mapRepositorySummary({
        name: "demo",
        full_name: "org/demo",
        private: true,
        default_branch: "main",
        language: "TypeScript",
        html_url: "https://github.com/org/demo",
        description: "Demo repo",
      }),
    ).toMatchObject({
      name: "demo",
      fullName: "org/demo",
      private: true,
      language: "TypeScript",
    });
  });

  it("maps branch", () => {
    expect(
      mapBranch({
        name: "main",
        commit: { sha: "abc" },
        protected: true,
      }),
    ).toEqual({ name: "main", sha: "abc", protected: true });
  });

  it("maps commit detail without patches", () => {
    const mapped = mapCommitDetail({
      sha: "deadbeef",
      html_url: "https://github.com/org/demo/commit/deadbeef",
      commit: {
        message: "fix bug\n\ndetails",
        author: { name: "Ada", date: "2026-01-01T00:00:00Z" },
      },
      author: { login: "ada" },
      stats: { additions: 1, deletions: 2 },
      files: [{ filename: "a.ts", status: "modified", additions: 1, deletions: 2, changes: 3, patch: "@@" }],
    });
    expect(mapped.message).toBe("fix bug");
    expect(mapped.files[0]).not.toHaveProperty("patch");
    expect(mapped.additions).toBe(1);
  });

  it("maps pull request summary", () => {
    expect(
      mapPullRequestSummary({
        number: 12,
        title: "Add feature",
        state: "open",
        draft: false,
        user: { login: "dev" },
        head: { ref: "feature" },
        base: { ref: "main" },
        html_url: "https://github.com/org/demo/pull/12",
      }),
    ).toMatchObject({
      number: 12,
      author: "dev",
      sourceBranch: "feature",
      targetBranch: "main",
    });
  });

  it("aggregates check conclusions", () => {
    const result = mapChecksResult([
      { name: "build", status: "completed", conclusion: "success" },
      { name: "test", status: "completed", conclusion: "failure" },
    ]);
    expect(result.status).toBe("completed");
    expect(result.conclusion).toBe("failure");
  });
});
