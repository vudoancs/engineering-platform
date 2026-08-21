import { describe, expect, it } from "vitest";
import {
  extractPlainText,
  mapIssueDetail,
  mapIssueSummary,
  mapSearchResult,
  truncateText,
} from "../src/integrations/jira/jira.mapper.js";
import type { JiraIssueApi } from "../src/integrations/jira/jira.types.js";

describe("JiraMapper", () => {
  it("maps compact issue summary", () => {
    const issue: JiraIssueApi = {
      key: "KYGO-1",
      fields: {
        summary: "Ship feature",
        status: { name: "In Progress", statusCategory: { name: "In Progress" } },
        issuetype: { name: "Story" },
        priority: { name: "High" },
        assignee: { displayName: "Ada" },
        reporter: { displayName: "Grace" },
        labels: ["backend"],
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-02T00:00:00.000Z",
        duedate: "2026-01-10",
        project: { key: "KYGO" },
      },
    };

    expect(mapIssueSummary(issue)).toMatchObject({
      key: "KYGO-1",
      summary: "Ship feature",
      status: "In Progress",
      issueType: "Story",
      assignee: "Ada",
    });
  });

  it("maps issue detail with truncated ADF description", () => {
    const issue: JiraIssueApi = {
      key: "CLUBSYNC-9",
      fields: {
        summary: "Fix login",
        description: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Broken auth flow" }],
            },
          ],
        },
        status: { name: "To Do" },
        issuetype: { name: "Bug" },
        components: [{ name: "api" }],
        project: { key: "CLUBSYNC" },
      },
    };

    const mapped = mapIssueDetail("clubsync", issue, "https://example.atlassian.net");
    expect(mapped.projectId).toBe("clubsync");
    expect(mapped.description).toBe("Broken auth flow");
    expect(mapped.url).toBe("https://example.atlassian.net/browse/CLUBSYNC-9");
    expect(mapped.components).toEqual(["api"]);
  });

  it("maps search results", () => {
    const result = mapSearchResult(
      "kygo",
      {
        issues: [
          {
            key: "KYGO-1",
            fields: {
              summary: "A",
              status: { name: "Done" },
              issuetype: { name: "Task" },
              labels: [],
            },
          },
        ],
      },
      1,
    );
    expect(result.total).toBe(1);
    expect(result.issues).toHaveLength(1);
  });

  it("extracts and truncates plain text", () => {
    expect(extractPlainText("hello")).toBe("hello");
    expect(truncateText("abcdef", 3)).toBe("abc…");
  });

  it("handles malformed description nodes", () => {
    expect(extractPlainText({ weird: true })).toBe("");
  });
});
