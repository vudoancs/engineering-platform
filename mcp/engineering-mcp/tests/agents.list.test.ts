import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentService, DEFAULT_KNOWN_MCP_TOOLS } from "engineering-platform/agents";
import { loadMcpEnv } from "../src/config/env.config.js";
import { PermissionService } from "../src/security/permission.service.js";
import { Logger } from "../src/services/logger.js";
import { ProjectContextService } from "../src/services/project-context.service.js";
import { createEngineeringTools } from "../src/tools/engineering/index.js";
import { createToolContext } from "../src/tools/tool-context.js";

const agentsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../agents",
);
const projectsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../projects",
);

describe("engineering_list_agents", () => {
  it("returns agent summaries without instructions", async () => {
    const agents = AgentService.loadFromDirectory({
      agentsDir,
      knownTools: DEFAULT_KNOWN_MCP_TOOLS,
    });
    const tool = createEngineeringTools().find((t) => t.name === "engineering_list_agents");
    expect(tool).toBeDefined();

    const context = createToolContext({
      config: loadMcpEnv({}),
      logger: new Logger({ level: "error", sink: () => undefined }),
      permissions: new PermissionService({ readOnly: true }),
      projects: ProjectContextService.createDefault(projectsDir),
      agents,
    });

    const result = await tool!.execute(context, {});
    expect(result.isError).toBeUndefined();
    const text = result.content[0];
    expect(text?.type).toBe("text");
    if (text?.type !== "text") {
      throw new Error("expected text content");
    }
    const payload = JSON.parse(text.text) as {
      agents: Array<{ id: string; name: string; role: string; governanceProfile: string }>;
    };
    expect(payload.agents.map((a) => a.id).sort()).toEqual([
      "developer",
      "engineering-manager",
      "reviewer",
    ]);
    expect(JSON.stringify(payload)).not.toContain("Never fabricate");
  });
});
