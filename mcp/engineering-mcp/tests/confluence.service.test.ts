import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ProjectConfigLoader, ProjectConfigService } from "engineering-platform/config";
import { loadMcpEnv } from "../src/config/env.config.js";
import { McpPermissionError, McpProjectNotFoundError } from "../src/errors/mcp-errors.js";
import { ConfluenceClient } from "../src/integrations/confluence/confluence.client.js";
import {
  ConfluenceConfigurationError,
  ConfluenceProjectBoundaryError,
} from "../src/integrations/confluence/confluence.errors.js";
import { ConfluenceService } from "../src/integrations/confluence/confluence.service.js";
import { PermissionService } from "../src/security/permission.service.js";
import { Logger } from "../src/services/logger.js";
import { ProjectContextService } from "../src/services/project-context.service.js";
import { createConfluenceTools } from "../src/tools/confluence/index.js";
import { createToolContext } from "../src/tools/tool-context.js";

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
  return new ConfluenceClient({
    baseUrl: "https://example.atlassian.net",
    email: "user@example.com",
    apiToken: "token",
    maxRetries: 0,
    fetchImpl: async (input, init) => handler(String(input), init),
  });
}

describe("ConfluenceService", () => {
  it("gets valid Kygo space from project config", async () => {
    const client = mockClient(async (url) => {
      expect(url).toContain("/rest/api/space/KYGO");
      return json(200, {
        key: "KYGO",
        name: "Kygo Space",
        type: "global",
        status: "current",
      });
    });
    const service = new ConfluenceService({
      projectConfigService: createProjectConfigService(),
      client,
    });
    const space = await service.getSpace("kygo");
    expect(space.spaceKey).toBe("KYGO");
    expect(space.projectId).toBe("kygo");
  });

  it("gets valid ClubSync space from project config", async () => {
    const client = mockClient(async (url) => {
      expect(url).toContain("/rest/api/space/CLUBSYNC");
      return json(200, { key: "CLUBSYNC", name: "ClubSync Space", type: "global" });
    });
    const service = new ConfluenceService({
      projectConfigService: createProjectConfigService(),
      client,
    });
    const space = await service.getSpace("clubsync");
    expect(space.spaceKey).toBe("CLUBSYNC");
  });

  it("allows Kygo → KYGO via assertAllowedSpace", () => {
    const service = new ConfluenceService({
      projectConfigService: createProjectConfigService(),
      client: mockClient(async () => json(200, {})),
    });
    expect(() => service.assertAllowedSpace("kygo", "KYGO")).not.toThrow();
  });

  it("allows ClubSync → CLUBSYNC via assertAllowedSpace", () => {
    const service = new ConfluenceService({
      projectConfigService: createProjectConfigService(),
      client: mockClient(async () => json(200, {})),
    });
    expect(() => service.assertAllowedSpace("clubsync", "CLUBSYNC")).not.toThrow();
  });

  it("rejects Kygo → CLUBSYNC", () => {
    const service = new ConfluenceService({
      projectConfigService: createProjectConfigService(),
      client: mockClient(async () => json(200, {})),
    });
    expect(() => service.assertAllowedSpace("kygo", "CLUBSYNC")).toThrow(
      ConfluenceProjectBoundaryError,
    );
  });

  it("rejects ClubSync → KYGO", () => {
    const service = new ConfluenceService({
      projectConfigService: createProjectConfigService(),
      client: mockClient(async () => json(200, {})),
    });
    expect(() => service.assertAllowedSpace("clubsync", "KYGO")).toThrow(
      ConfluenceProjectBoundaryError,
    );
  });

  it("rejects unknown project", async () => {
    const service = new ConfluenceService({
      projectConfigService: createProjectConfigService(),
      client: mockClient(async () => json(200, {})),
    });
    await expect(service.getSpace("unknown-project")).rejects.toBeInstanceOf(
      McpProjectNotFoundError,
    );
  });

  it("errors clearly when Confluence credentials are missing", async () => {
    const service = new ConfluenceService({
      projectConfigService: createProjectConfigService(),
      client: null,
    });
    await expect(service.getSpace("kygo")).rejects.toBeInstanceOf(ConfluenceConfigurationError);
  });

  it("search is space-scoped via CQL", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const cql = new URL(url).searchParams.get("cql") ?? "";
      expect(cql).toContain('space = "KYGO"');
      expect(cql).toContain('text ~ "authentication"');
      expect(cql).not.toContain("CLUBSYNC");
      return json(200, {
        totalSize: 1,
        results: [
          {
            excerpt: "auth docs",
            content: {
              id: "10",
              type: "page",
              title: "Authentication",
              status: "current",
              space: { key: "KYGO" },
              _links: { webui: "/spaces/KYGO/pages/10" },
            },
          },
        ],
      });
    });

    const client = new ConfluenceClient({
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
      maxRetries: 0,
      fetchImpl,
    });

    const service = new ConfluenceService({
      projectConfigService: createProjectConfigService(),
      client,
    });

    const result = await service.searchPages("kygo", { query: "authentication", limit: 20 });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.spaceKey).toBe("KYGO");
    expect(result.total).toBe(1);
  });

  it("rejects getPage when page belongs to another space", async () => {
    const client = mockClient(async () =>
      json(200, {
        id: "1",
        title: "Other",
        space: { key: "CLUBSYNC" },
        body: { storage: { value: "<p>x</p>" } },
      }),
    );
    const service = new ConfluenceService({
      projectConfigService: createProjectConfigService(),
      client,
    });
    await expect(service.getPage("kygo", "1")).rejects.toBeInstanceOf(
      ConfluenceProjectBoundaryError,
    );
  });

  it("truncates oversized page content with truncated=true", async () => {
    const huge = `<p>${"A".repeat(5000)}</p>`;
    const client = mockClient(async () =>
      json(200, {
        id: "2",
        title: "Large",
        space: { key: "KYGO" },
        body: { storage: { value: huge } },
        version: { number: 1 },
      }),
    );
    const service = new ConfluenceService({
      projectConfigService: createProjectConfigService(),
      client,
      maxPageSizeBytes: 100,
    });
    const page = await service.getPage("kygo", "2");
    expect(page.truncated).toBe(true);
    expect(page.body).toContain("…[truncated]");
  });

  it("returns children without bodies", async () => {
    const client = mockClient(async (url) => {
      if (url.includes("/child/page")) {
        return json(200, {
          results: [
            {
              id: "3",
              title: "Child",
              status: "current",
              space: { key: "KYGO" },
              _links: { webui: "/spaces/KYGO/pages/3" },
            },
          ],
        });
      }
      return json(200, { id: "2", title: "Parent", space: { key: "KYGO" } });
    });
    const service = new ConfluenceService({
      projectConfigService: createProjectConfigService(),
      client,
    });
    const result = await service.getPageChildren("kygo", "2");
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).not.toHaveProperty("body");
  });

  it("returns ancestors", async () => {
    const client = mockClient(async () =>
      json(200, {
        id: "5",
        title: "Leaf",
        space: { key: "KYGO" },
        ancestors: [
          { id: "1", title: "Root", _links: { webui: "/spaces/KYGO/pages/1" } },
          { id: "2", title: "Mid", _links: { webui: "/spaces/KYGO/pages/2" } },
        ],
      }),
    );
    const service = new ConfluenceService({
      projectConfigService: createProjectConfigService(),
      client,
    });
    const result = await service.getPageAncestors("kygo", "5");
    expect(result.ancestors.map((a) => a.id)).toEqual(["1", "2"]);
  });

  it("returns labels", async () => {
    const client = mockClient(async (url) => {
      if (url.includes("/label")) {
        return json(200, { results: [{ id: "9", name: "architecture" }] });
      }
      return json(200, { id: "5", title: "Doc", space: { key: "KYGO" } });
    });
    const service = new ConfluenceService({
      projectConfigService: createProjectConfigService(),
      client,
    });
    const result = await service.getPageLabels("kygo", "5");
    expect(result.labels).toEqual([{ id: "9", name: "architecture" }]);
  });

  it("enforces read-only permission on Confluence tools", async () => {
    const tools = createConfluenceTools();
    const search = tools.find((t) => t.name === "confluence_search_pages");
    expect(search).toBeDefined();

    const context = createToolContext({
      config: loadMcpEnv({}),
      logger: new Logger({ level: "error", sink: () => undefined }),
      permissions: new PermissionService({ readOnly: true }),
      projects: ProjectContextService.createDefault(projectsDir),
      confluence: new ConfluenceService({
        projectConfigService: createProjectConfigService(),
        client: null,
      }),
    });

    // WRITE is denied; READ succeeds past permission gate (then hits missing credentials)
    context.permissions.assertAllowed("READ");
    expect(() => context.permissions.assertAllowed("WRITE")).toThrow(McpPermissionError);

    await expect(
      search!.execute(context, { projectId: "kygo", query: "x" }),
    ).rejects.toBeInstanceOf(ConfluenceConfigurationError);
  });

  it("rejects limit above maximum", async () => {
    const service = new ConfluenceService({
      projectConfigService: createProjectConfigService(),
      client: mockClient(async () => json(200, { results: [] })),
    });
    await expect(service.searchPages("kygo", { limit: 101 })).rejects.toMatchObject({
      code: "CONFLUENCE_VALIDATION_ERROR",
    });
  });

  it("project boundary error JSON shape", () => {
    const error = new ConfluenceProjectBoundaryError(
      "Space CLUBSYNC is not configured for project kygo.",
      {
        details: {
          projectId: "kygo",
          configuredSpaceKey: "KYGO",
          attemptedSpaceKey: "CLUBSYNC",
        },
      },
    );
    expect(error.toJSON()).toEqual({
      code: "CONFLUENCE_PROJECT_BOUNDARY_VIOLATION",
      message: "Space CLUBSYNC is not configured for project kygo.",
      retryable: false,
      provider: "confluence",
      details: {
        projectId: "kygo",
        configuredSpaceKey: "KYGO",
        attemptedSpaceKey: "CLUBSYNC",
      },
    });
  });
});
