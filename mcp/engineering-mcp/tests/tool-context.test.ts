import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { McpProjectNotFoundError } from "../src/errors/mcp-errors.js";
import { loadMcpEnv } from "../src/config/env.config.js";
import { PermissionService } from "../src/security/permission.service.js";
import { Logger } from "../src/services/logger.js";
import { ProjectContextService } from "../src/services/project-context.service.js";
import { createToolContext } from "../src/tools/tool-context.js";

const projectsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../projects",
);

describe("ToolContext and ProjectContext", () => {
  it("creates ToolContext with requestId", () => {
    const config = loadMcpEnv({});
    const context = createToolContext({
      config,
      logger: new Logger({ level: "error", sink: () => undefined }),
      permissions: new PermissionService({ readOnly: true }),
      projects: ProjectContextService.createDefault(projectsDir),
      projectId: "kygo",
      jira: null,
      github: null,
    });

    expect(context.requestId.length).toBeGreaterThan(0);
    expect(context.projectId).toBe("kygo");
  });

  it("resolves valid projectId through ProjectConfigService", () => {
    const projects = ProjectContextService.createDefault(projectsDir);
    const project = projects.resolveProject("kygo");
    expect(project.id).toBe("kygo");
    expect(project.jira?.projectKey).toBe("KYGO");
  });

  it("handles invalid projectId with McpProjectNotFoundError", () => {
    const projects = ProjectContextService.createDefault(projectsDir);
    expect(() => projects.resolveProject("does-not-exist")).toThrow(
      McpProjectNotFoundError,
    );
  });
});
