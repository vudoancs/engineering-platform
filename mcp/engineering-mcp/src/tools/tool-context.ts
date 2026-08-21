import { randomUUID } from "node:crypto";
import type { AgentService } from "engineering-platform/agents";
import type { GovernanceService } from "engineering-platform/governance";
import type { McpEnvConfig } from "../config/env.config.js";
import type { ConfluenceService } from "../integrations/confluence/confluence.service.js";
import type { GitHubService } from "../integrations/github/github.service.js";
import type { JiraService } from "../integrations/jira/jira.service.js";
import type { PermissionService } from "../security/permission.service.js";
import type { EngineeringService } from "../services/engineering/engineering.service.js";
import type { Logger } from "../services/logger.js";
import type { ProjectContextService } from "../services/project-context.service.js";

/**
 * Shared context passed to future tool handlers.
 * Contains references only — no business logic.
 */
export interface ToolContext {
  requestId: string;
  projectId?: string;
  logger: Logger;
  permissions: PermissionService;
  projects: ProjectContextService;
  config: McpEnvConfig;
  jira: JiraService | null;
  github: GitHubService | null;
  confluence: ConfluenceService | null;
  engineering: EngineeringService | null;
  governance: GovernanceService | null;
  agents: AgentService | null;
}

export interface CreateToolContextInput {
  logger: Logger;
  permissions: PermissionService;
  projects: ProjectContextService;
  config: McpEnvConfig;
  jira?: JiraService | null;
  github?: GitHubService | null;
  confluence?: ConfluenceService | null;
  engineering?: EngineeringService | null;
  governance?: GovernanceService | null;
  agents?: AgentService | null;
  projectId?: string;
  requestId?: string;
}

export function createToolContext(input: CreateToolContextInput): ToolContext {
  return {
    requestId: input.requestId ?? randomUUID(),
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    logger: input.logger,
    permissions: input.permissions,
    projects: input.projects,
    config: input.config,
    jira: input.jira ?? null,
    github: input.github ?? null,
    confluence: input.confluence ?? null,
    engineering: input.engineering ?? null,
    governance: input.governance ?? null,
    agents: input.agents ?? null,
  };
}
