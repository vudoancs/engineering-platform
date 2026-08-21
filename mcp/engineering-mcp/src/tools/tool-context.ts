import { randomUUID } from "node:crypto";
import type { McpEnvConfig } from "../config/env.config.js";
import type { PermissionService } from "../security/permission.service.js";
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
}

export interface CreateToolContextInput {
  logger: Logger;
  permissions: PermissionService;
  projects: ProjectContextService;
  config: McpEnvConfig;
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
  };
}
