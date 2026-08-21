import { describe, expect, it } from "vitest";
import { constrainJqlToProject } from "../src/integrations/jira/jira.jql.js";
import { JiraProjectBoundaryError } from "../src/integrations/jira/jira.errors.js";

describe("JQL project isolation", () => {
  it("allows JQL without project clause", () => {
    const result = constrainJqlToProject("KYGO", 'status = "In Progress"');
    expect(result.jql).toBe('project = "KYGO" AND (status = "In Progress")');
  });

  it("allows JQL with correct project clause", () => {
    const result = constrainJqlToProject("KYGO", 'project = KYGO AND status = "In Progress"');
    expect(result.jql).toContain('project = "KYGO" AND');
  });

  it("allows empty JQL", () => {
    expect(constrainJqlToProject("KYGO").jql).toBe('project = "KYGO"');
  });

  it("rejects JQL with wrong project", () => {
    expect(() => constrainJqlToProject("KYGO", "project = CLUBSYNC")).toThrow(
      JiraProjectBoundaryError,
    );
  });

  it("rejects JQL with multiple projects", () => {
    expect(() =>
      constrainJqlToProject("KYGO", "project in (KYGO, CLUBSYNC)"),
    ).toThrow(JiraProjectBoundaryError);
  });

  it("rejects project != clauses", () => {
    expect(() => constrainJqlToProject("KYGO", "project != KYGO")).toThrow(
      JiraProjectBoundaryError,
    );
  });
});
