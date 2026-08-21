import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ProjectConfigLoader, ProjectConfigService } from "engineering-platform/config";
import { JiraClient } from "../src/integrations/jira/jira.client.js";
import {
  JiraConfigurationError,
  JiraProjectBoundaryError,
  JiraValidationError,
} from "../src/integrations/jira/jira.errors.js";
import { JiraService } from "../src/integrations/jira/jira.service.js";
import { createJiraTools } from "../src/tools/jira/index.js";
import { createToolContext } from "../src/tools/tool-context.js";
import { loadMcpEnv } from "../src/config/env.config.js";
import { PermissionService } from "../src/security/permission.service.js";
import { Logger } from "../src/services/logger.js";
import { ProjectContextService } from "../src/services/project-context.service.js";
import { McpPermissionError } from "../src/errors/mcp-errors.js";

const projectsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../projects",
);

function createProjectConfigService(): ProjectConfigService {
  return new ProjectConfigService({
    loader: new ProjectConfigLoader({ projectsDir }),
  });
}

function mockClient(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  return new JiraClient({
    baseUrl: "https://example.atlassian.net",
    email: "user@example.com",
    apiToken: "token",
    maxRetries: 0,
    fetchImpl: async (input, init) => handler(String(input), init),
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("JiraService", () => {
  it("resolves Kygo project configuration", async () => {
    const client = mockClient(async (url) => {
      if (url.includes("/rest/api/3/project/KYGO")) {
        return json(200, {
          key: "KYGO",
          name: "Kygo",
          projectTypeKey: "software",
          lead: { displayName: "Lead" },
        });
      }
      return json(404, { errorMessages: ["no"] });
    });

    const service = new JiraService({
      projectConfigService: createProjectConfigService(),
      client,
    });

    const project = await service.getProject("kygo");
    expect(project.jiraProjectKey).toBe("KYGO");
    expect(project.projectId).toBe("kygo");
  });

  it("resolves ClubSync project configuration", async () => {
    const client = mockClient(async (url) => {
      if (url.includes("/rest/api/3/project/CLUBSYNC")) {
        return json(200, { key: "CLUBSYNC", name: "ClubSync" });
      }
      return json(404, {});
    });

    const service = new JiraService({
      projectConfigService: createProjectConfigService(),
      client,
    });

    const project = await service.getProject("clubsync");
    expect(project.jiraProjectKey).toBe("CLUBSYNC");
  });

  it("fails when Jira is not configured", async () => {
    const service = new JiraService({
      projectConfigService: createProjectConfigService(),
      client: null,
    });
    await expect(service.getCurrentUser()).rejects.toBeInstanceOf(JiraConfigurationError);
  });

  it("allows Kygo requesting KYGO issue", async () => {
    const client = mockClient(async (url) => {
      if (url.includes("/rest/api/3/issue/KYGO-1")) {
        return json(200, {
          key: "KYGO-1",
          fields: {
            summary: "Work",
            status: { name: "To Do" },
            issuetype: { name: "Task" },
            labels: [],
            project: { key: "KYGO" },
          },
        });
      }
      return json(404, {});
    });

    const service = new JiraService({
      projectConfigService: createProjectConfigService(),
      client,
    });

    const issue = await service.getIssue("kygo", "KYGO-1");
    expect(issue.key).toBe("KYGO-1");
  });

  it("rejects Kygo requesting CLUBSYNC issue", async () => {
    const client = mockClient(async () =>
      json(200, {
        key: "CLUBSYNC-123",
        fields: {
          summary: "Other",
          status: { name: "To Do" },
          issuetype: { name: "Task" },
          labels: [],
          project: { key: "CLUBSYNC" },
        },
      }),
    );

    const service = new JiraService({
      projectConfigService: createProjectConfigService(),
      client,
    });

    await expect(service.getIssue("kygo", "CLUBSYNC-123")).rejects.toBeInstanceOf(
      JiraProjectBoundaryError,
    );
  });

  it("allows ClubSync requesting CLUBSYNC issue", async () => {
    const client = mockClient(async () =>
      json(200, {
        key: "CLUBSYNC-5",
        fields: {
          summary: "Sync",
          status: { name: "Done" },
          issuetype: { name: "Bug" },
          labels: [],
          project: { key: "CLUBSYNC" },
        },
      }),
    );

    const service = new JiraService({
      projectConfigService: createProjectConfigService(),
      client,
    });

    const issue = await service.getIssue("clubsync", "CLUBSYNC-5");
    expect(issue.projectId).toBe("clubsync");
  });

  it("constrains search JQL to configured project", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/rest/api/3/search/jql")) {
        return json(200, {
          issues: [
            {
              key: "KYGO-2",
              fields: {
                summary: "In progress",
                status: { name: "In Progress" },
                issuetype: { name: "Story" },
                labels: [],
                project: { key: "KYGO" },
              },
            },
          ],
        });
      }
      if (url.includes("/rest/api/3/search/approximate-count")) {
        return json(200, { count: 1 });
      }
      return json(404, {});
    });

    const client = new JiraClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
      maxRetries: 0,
      fetchImpl,
    });

    const service = new JiraService({
      projectConfigService: createProjectConfigService(),
      client,
    });

    const result = await service.searchIssues("kygo", 'status = "In Progress"', 20);
    expect(result.projectId).toBe("kygo");
    expect(result.total).toBe(1);

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.jql).toContain('project = "KYGO"');
    expect(body.jql).toContain('status = "In Progress"');
  });

  it("rejects search JQL with wrong project", async () => {
    const service = new JiraService({
      projectConfigService: createProjectConfigService(),
      client: mockClient(async () => json(200, {})),
    });
    await expect(service.searchIssues("kygo", "project = CLUBSYNC")).rejects.toBeInstanceOf(
      JiraProjectBoundaryError,
    );
  });

  it("rejects invalid maxResults", async () => {
    const service = new JiraService({
      projectConfigService: createProjectConfigService(),
      client: mockClient(async () => json(200, {})),
    });
    await expect(service.searchIssues("kygo", undefined, 101)).rejects.toBeInstanceOf(
      JiraValidationError,
    );
  });

  it("verifies sprint issues stay in project boundary", async () => {
    const client = mockClient(async (url) => {
      if (url.includes("/rest/agile/1.0/sprint/12") && !url.includes("/issue")) {
        return json(200, { id: 12, name: "Sprint 12", state: "active" });
      }
      if (url.includes("/issue") && url.includes("jql=")) {
        return json(200, {
          issues: [
            {
              key: "KYGO-9",
              fields: {
                summary: "A",
                status: { name: "To Do" },
                project: { key: "KYGO" },
              },
            },
          ],
        });
      }
      if (url.includes("/issue")) {
        return json(200, {
          issues: [
            {
              key: "KYGO-9",
              fields: { project: { key: "KYGO" } },
            },
          ],
        });
      }
      return json(404, {});
    });

    const service = new JiraService({
      projectConfigService: createProjectConfigService(),
      client,
    });

    const sprint = await service.getSprint("kygo", 12);
    expect(sprint.id).toBe(12);
    expect(sprint.issues[0]?.key).toBe("KYGO-9");
  });

  it("rejects sprint containing foreign project issues", async () => {
    const client = mockClient(async (url) => {
      if (url.includes("/rest/agile/1.0/sprint/99") && !url.includes("/issue")) {
        return json(200, { id: 99, name: "Bad Sprint" });
      }
      if (url.includes("/issue") && url.includes("jql=")) {
        return json(200, { issues: [] });
      }
      if (url.includes("/issue")) {
        return json(200, {
          issues: [
            {
              key: "CLUBSYNC-1",
              fields: { project: { key: "CLUBSYNC" } },
            },
          ],
        });
      }
      return json(404, {});
    });

    const service = new JiraService({
      projectConfigService: createProjectConfigService(),
      client,
    });

    await expect(service.getSprint("kygo", 99)).rejects.toBeInstanceOf(
      JiraProjectBoundaryError,
    );
  });
});

describe("Jira MCP tools permission", () => {
  it("allows READ when MCP_READ_ONLY=true", async () => {
    const tools = createJiraTools();
    const search = tools.find((tool) => tool.name === "jira_search_issues");
    expect(search).toBeDefined();

    const jira = new JiraService({
      projectConfigService: createProjectConfigService(),
      client: mockClient(async (url) => {
        if (url.includes("search/jql")) {
          return json(200, { issues: [] });
        }
        if (url.includes("approximate-count")) {
          return json(200, { count: 0 });
        }
        return json(404, {});
      }),
    });

    const context = createToolContext({
      config: loadMcpEnv({ MCP_READ_ONLY: "true" }),
      logger: new Logger({ level: "error", sink: () => undefined }),
      permissions: new PermissionService({ readOnly: true }),
      projects: ProjectContextService.createDefault(projectsDir),
      jira,
    });

    const result = await search!.execute(context, {
      projectId: "kygo",
      maxResults: 10,
    });
    expect(result.isError).toBeUndefined();
  });

  it("still blocks WRITE via permission layer", () => {
    const permissions = new PermissionService({ readOnly: true });
    expect(() => permissions.assertAllowed("WRITE")).toThrow(McpPermissionError);
  });
});
