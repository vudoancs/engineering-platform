import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { loadMcpEnv, type McpEnvConfig } from "../config/env.config.js";
import { McpError } from "../errors/mcp-errors.js";
import { PermissionService } from "../security/permission.service.js";
import { HealthService } from "../services/health.service.js";
import { Logger } from "../services/logger.js";
import { ProjectContextService } from "../services/project-context.service.js";
import { createToolContext } from "../tools/tool-context.js";
import { ResourceRegistry } from "./resource-registry.js";
import { ToolRegistry } from "./tool-registry.js";

export interface EngineeringMcpRuntime {
  config: McpEnvConfig;
  logger: Logger;
  permissions: PermissionService;
  projects: ProjectContextService;
  health: HealthService;
  tools: ToolRegistry;
  resources: ResourceRegistry;
  server: McpServer;
}

export interface McpServerFactoryOptions {
  env?: NodeJS.ProcessEnv;
  projectsDir?: string;
  logger?: Logger;
  toolRegistry?: ToolRegistry;
  resourceRegistry?: ResourceRegistry;
}

/**
 * Creates and wires the engineering-mcp server.
 * Registers tools/resources from registries onto the official MCP SDK server.
 */
export class McpServerFactory {
  create(options: McpServerFactoryOptions = {}): EngineeringMcpRuntime {
    const config = loadMcpEnv(options.env ?? process.env);
    const logger =
      options.logger ??
      new Logger({
        level: config.LOG_LEVEL,
      });

    const projectsDir =
      options.projectsDir ??
      config.PROJECTS_DIR ??
      resolveDefaultProjectsDir();

    const projects = ProjectContextService.createDefault(projectsDir);
    const permissions = new PermissionService({ readOnly: config.MCP_READ_ONLY });
    const health = new HealthService();
    const tools = options.toolRegistry ?? new ToolRegistry();
    const resources = options.resourceRegistry ?? new ResourceRegistry();

    const server = new McpServer({
      name: config.MCP_SERVER_NAME,
      version: config.MCP_SERVER_VERSION,
    });

    this.applyTools(server, tools, {
      config,
      logger,
      permissions,
      projects,
    });
    this.applyResources(server, resources, {
      config,
      logger,
      permissions,
      projects,
    });

    logger.info("mcp_server_created", {
      name: config.MCP_SERVER_NAME,
      version: config.MCP_SERVER_VERSION,
      readOnly: config.MCP_READ_ONLY,
      toolCount: tools.size(),
      resourceCount: resources.size(),
      projectsDir,
    });

    return {
      config,
      logger,
      permissions,
      projects,
      health,
      tools,
      resources,
      server,
    };
  }

  async connectStdio(runtime: EngineeringMcpRuntime): Promise<void> {
    const transport = new StdioServerTransport();
    await runtime.server.connect(transport);
    runtime.logger.info("mcp_stdio_connected", {
      name: runtime.config.MCP_SERVER_NAME,
      version: runtime.config.MCP_SERVER_VERSION,
    });
  }

  private applyTools(
    server: McpServer,
    tools: ToolRegistry,
    deps: {
      config: McpEnvConfig;
      logger: Logger;
      permissions: PermissionService;
      projects: ProjectContextService;
    },
  ): void {
    for (const tool of tools.list()) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
        },
        async (args) => {
          const projectId =
            typeof args === "object" &&
            args !== null &&
            "projectId" in args &&
            typeof Reflect.get(args, "projectId") === "string"
              ? (Reflect.get(args, "projectId") as string)
              : undefined;

          const context = createToolContext({
            ...deps,
            ...(projectId !== undefined ? { projectId } : {}),
          });

          const startedAt = Date.now();
          const startTime = new Date(startedAt).toISOString();

          try {
            const result = await tool.execute(context, args);
            deps.logger.logToolInvocation({
              requestId: context.requestId,
              toolName: tool.name,
              ...(projectId !== undefined ? { projectId } : {}),
              startTime,
              durationMs: Date.now() - startedAt,
              success: true,
            });
            return result;
          } catch (error) {
            const errorCode = error instanceof McpError ? error.code : "MCP_ERROR";
            deps.logger.logToolInvocation({
              requestId: context.requestId,
              toolName: tool.name,
              ...(projectId !== undefined ? { projectId } : {}),
              startTime,
              durationMs: Date.now() - startedAt,
              success: false,
              errorCode,
            });

            const message =
              error instanceof Error ? error.message : "Unexpected tool execution error";

            const failure: CallToolResult = {
              isError: true,
              content: [{ type: "text", text: message }],
            };
            return failure;
          }
        },
      );
    }
  }

  private applyResources(
    server: McpServer,
    resources: ResourceRegistry,
    deps: {
      config: McpEnvConfig;
      logger: Logger;
      permissions: PermissionService;
      projects: ProjectContextService;
    },
  ): void {
    for (const resource of resources.list()) {
      server.registerResource(
        resource.name,
        resource.uri,
        {
          ...(resource.description !== undefined
            ? { description: resource.description }
            : {}),
          ...(resource.mimeType !== undefined ? { mimeType: resource.mimeType } : {}),
        },
        async () => {
          const context = createToolContext(deps);
          return resource.read(context);
        },
      );
    }
  }
}

function resolveDefaultProjectsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/server -> repo root projects/
  return path.resolve(here, "../../../../projects");
}
