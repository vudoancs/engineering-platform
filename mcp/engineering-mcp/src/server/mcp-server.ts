import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  GovernanceError,
  GovernanceService,
  type GovernanceService as GovernanceServiceType,
} from "engineering-platform/governance";
import {
  hasConfluenceCredentials,
  hasGitHubCredentials,
  hasJiraCredentials,
  loadMcpEnv,
  type McpEnvConfig,
} from "../config/env.config.js";
import { McpError } from "../errors/mcp-errors.js";
import { ConfluenceError } from "../integrations/confluence/confluence.errors.js";
import {
  createConfluenceClientFromEnv,
  ConfluenceService,
} from "../integrations/confluence/confluence.service.js";
import { GitHubError } from "../integrations/github/github.errors.js";
import {
  createGitHubClientFromEnv,
  GitHubService,
} from "../integrations/github/github.service.js";
import { JiraError } from "../integrations/jira/jira.errors.js";
import {
  createJiraClientFromEnv,
  JiraService,
} from "../integrations/jira/jira.service.js";
import { PermissionService } from "../security/permission.service.js";
import { EngineeringError } from "../services/engineering/engineering.errors.js";
import { EngineeringService } from "../services/engineering/engineering.service.js";
import { HealthService } from "../services/health.service.js";
import { Logger } from "../services/logger.js";
import { ProjectContextService } from "../services/project-context.service.js";
import { createConfluenceTools } from "../tools/confluence/index.js";
import { createEngineeringTools } from "../tools/engineering/index.js";
import { createGovernanceTools } from "../tools/governance/index.js";
import { createGitHubTools } from "../tools/github/index.js";
import { createJiraTools } from "../tools/jira/index.js";
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
  jira: JiraService;
  github: GitHubService;
  confluence: ConfluenceService;
  engineering: EngineeringService;
  governance: GovernanceServiceType;
  server: McpServer;
}

export interface McpServerFactoryOptions {
  env?: NodeJS.ProcessEnv;
  projectsDir?: string;
  policiesDir?: string;
  logger?: Logger;
  toolRegistry?: ToolRegistry;
  resourceRegistry?: ResourceRegistry;
  jiraService?: JiraService;
  githubService?: GitHubService;
  confluenceService?: ConfluenceService;
  engineeringService?: EngineeringService;
  governanceService?: GovernanceServiceType;
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

    const policiesDir =
      options.policiesDir ??
      config.POLICIES_DIR ??
      resolveDefaultPoliciesDir();

    const projects = ProjectContextService.createDefault(projectsDir);
    const permissions = new PermissionService({ readOnly: config.MCP_READ_ONLY });
    const health = new HealthService();

    const projectConfigService = projects.getProjectConfigService();
    const isProjectKnown = (projectId: string): boolean => {
      try {
        projectConfigService.getProject(projectId);
        return true;
      } catch {
        return false;
      }
    };

    const governance =
      options.governanceService ??
      GovernanceService.loadFromDirectory({
        policiesDir,
        isProjectKnown,
      });

    const jira =
      options.jiraService ??
      new JiraService({
        projectConfigService: projects.getProjectConfigService(),
        client: hasJiraCredentials(config)
          ? createJiraClientFromEnv({
              ...(config.JIRA_BASE_URL !== undefined
                ? { JIRA_BASE_URL: config.JIRA_BASE_URL }
                : {}),
              ...(config.JIRA_EMAIL !== undefined ? { JIRA_EMAIL: config.JIRA_EMAIL } : {}),
              ...(config.JIRA_API_TOKEN !== undefined
                ? { JIRA_API_TOKEN: config.JIRA_API_TOKEN }
                : {}),
              JIRA_REQUEST_TIMEOUT_MS: config.JIRA_REQUEST_TIMEOUT_MS,
            })
          : null,
      });

    const github =
      options.githubService ??
      new GitHubService({
        projectConfigService: projects.getProjectConfigService(),
        client: hasGitHubCredentials(config)
          ? createGitHubClientFromEnv({
              ...(config.GITHUB_TOKEN !== undefined
                ? { GITHUB_TOKEN: config.GITHUB_TOKEN }
                : {}),
              ...(config.GITHUB_API_URL !== undefined
                ? { GITHUB_API_URL: config.GITHUB_API_URL }
                : {}),
              GITHUB_REQUEST_TIMEOUT_MS: config.GITHUB_REQUEST_TIMEOUT_MS,
            })
          : null,
        maxFileBytes: config.GITHUB_MAX_FILE_BYTES,
      });

    const confluence =
      options.confluenceService ??
      new ConfluenceService({
        projectConfigService: projects.getProjectConfigService(),
        client: hasConfluenceCredentials(config)
          ? createConfluenceClientFromEnv({
              ...(config.CONFLUENCE_BASE_URL !== undefined
                ? { CONFLUENCE_BASE_URL: config.CONFLUENCE_BASE_URL }
                : {}),
              ...(config.CONFLUENCE_EMAIL !== undefined
                ? { CONFLUENCE_EMAIL: config.CONFLUENCE_EMAIL }
                : {}),
              ...(config.CONFLUENCE_API_TOKEN !== undefined
                ? { CONFLUENCE_API_TOKEN: config.CONFLUENCE_API_TOKEN }
                : {}),
              CONFLUENCE_REQUEST_TIMEOUT_MS: config.CONFLUENCE_REQUEST_TIMEOUT_MS,
            })
          : null,
        maxPageSizeBytes: config.CONFLUENCE_MAX_PAGE_SIZE_BYTES,
      });

    const engineering =
      options.engineeringService ??
      new EngineeringService({
        jira,
        github,
        confluence,
        projectConfigService: projects.getProjectConfigService(),
        thresholds: {
          staleDays: config.ENGINEERING_STALE_DAYS,
          prStaleHours: config.PR_STALE_HOURS,
          prHighRiskHours: config.PR_HIGH_RISK_HOURS,
          prLargeChanges: config.PR_LARGE_CHANGES,
          prReviewWaitingHours: config.PR_REVIEW_WAITING_HOURS,
        },
      });

    const tools = options.toolRegistry ?? new ToolRegistry();
    if (!options.toolRegistry) {
      for (const tool of createJiraTools()) {
        tools.register(tool);
      }
      for (const tool of createGitHubTools()) {
        tools.register(tool);
      }
      for (const tool of createConfluenceTools()) {
        tools.register(tool);
      }
      for (const tool of createEngineeringTools()) {
        tools.register(tool);
      }
      for (const tool of createGovernanceTools()) {
        tools.register(tool);
      }
    }

    const resources = options.resourceRegistry ?? new ResourceRegistry();

    const server = new McpServer({
      name: config.MCP_SERVER_NAME,
      version: config.MCP_SERVER_VERSION,
    });

    const deps = {
      config,
      logger,
      permissions,
      projects,
      jira,
      github,
      confluence,
      engineering,
      governance,
    };

    this.applyTools(server, tools, deps);
    this.applyResources(server, resources, deps);

    logger.info("mcp_server_created", {
      name: config.MCP_SERVER_NAME,
      version: config.MCP_SERVER_VERSION,
      readOnly: config.MCP_READ_ONLY,
      toolCount: tools.size(),
      resourceCount: resources.size(),
      jiraConfigured: jira.isConfigured(),
      githubConfigured: github.isConfigured(),
      confluenceConfigured: confluence.isConfigured(),
      governanceFailClosed: governance.isFailClosed(),
      projectsDir,
      policiesDir,
    });

    return {
      config,
      logger,
      permissions,
      projects,
      health,
      tools,
      resources,
      jira,
      github,
      confluence,
      engineering,
      governance,
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
      jira: JiraService;
      github: GitHubService;
      confluence: ConfluenceService;
      engineering: EngineeringService;
      governance: GovernanceServiceType;
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
            const errorCode =
              error instanceof GovernanceError ||
              error instanceof EngineeringError ||
              error instanceof ConfluenceError ||
              error instanceof GitHubError ||
              error instanceof JiraError
                ? error.code
                : error instanceof McpError
                  ? error.code
                  : "MCP_ERROR";
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
              error instanceof GovernanceError ||
              error instanceof EngineeringError ||
              error instanceof ConfluenceError ||
              error instanceof GitHubError ||
              error instanceof JiraError
                ? JSON.stringify(error.toJSON())
                : error instanceof Error
                  ? error.message
                  : "Unexpected tool execution error";

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
      jira: JiraService;
      github: GitHubService;
      confluence: ConfluenceService;
      engineering: EngineeringService;
      governance: GovernanceServiceType;
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
  return path.resolve(here, "../../../../projects");
}

function resolveDefaultPoliciesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../../policies");
}
