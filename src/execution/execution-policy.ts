import type {
  ExecutionActionId,
  WriteActionDefinition,
} from "./execution.types.js";

/**
 * Central write action registry. Do not scatter permissions across call sites.
 */
export const WRITE_ACTION_REGISTRY: Record<ExecutionActionId, WriteActionDefinition> =
  {
    "github.create_branch": {
      action: "github.create_branch",
      enabled: true,
      riskLevel: "LOW",
      requiresApproval: false,
      allowedActors: ["human", "agent", "system", "workflow"],
      allowedAgentIds: ["developer"],
      projectScoped: true,
      governanceAction: "CREATE_BRANCH",
      mcpToolName: "github_create_branch",
    },
    "github.create_pull_request": {
      action: "github.create_pull_request",
      enabled: true,
      riskLevel: "MEDIUM",
      requiresApproval: false,
      allowedActors: ["human", "agent", "system", "workflow"],
      allowedAgentIds: ["developer"],
      projectScoped: true,
      governanceAction: "CREATE_PULL_REQUEST",
      mcpToolName: "github_create_pull_request",
    },
    "jira.update_issue": {
      action: "jira.update_issue",
      enabled: true,
      riskLevel: "MEDIUM",
      requiresApproval: true,
      allowedActors: ["human", "system", "workflow"],
      allowedAgentIds: [],
      projectScoped: true,
      governanceAction: "UPDATE_JIRA",
      mcpToolName: "jira_update_issue",
    },
    "github.merge_pull_request": {
      action: "github.merge_pull_request",
      enabled: false,
      riskLevel: "HIGH",
      requiresApproval: true,
      allowedActors: ["human", "system"],
      allowedAgentIds: [],
      projectScoped: true,
      governanceAction: "MERGE_PULL_REQUEST",
    },
    "confluence.update_page": {
      action: "confluence.update_page",
      enabled: false,
      riskLevel: "MEDIUM",
      requiresApproval: true,
      allowedActors: ["human", "system"],
      allowedAgentIds: [],
      projectScoped: true,
      governanceAction: "UPDATE_CONFLUENCE",
    },
    "deploy.staging": {
      action: "deploy.staging",
      enabled: false,
      riskLevel: "HIGH",
      requiresApproval: true,
      allowedActors: ["human", "system"],
      allowedAgentIds: [],
      projectScoped: true,
      governanceAction: "DEPLOY_STAGING",
    },
    "deploy.production": {
      action: "deploy.production",
      enabled: false,
      riskLevel: "CRITICAL",
      requiresApproval: true,
      allowedActors: ["human", "system"],
      allowedAgentIds: [],
      projectScoped: true,
      governanceAction: "DEPLOY_PRODUCTION",
    },
    "database.migration": {
      action: "database.migration",
      enabled: false,
      riskLevel: "CRITICAL",
      requiresApproval: true,
      allowedActors: ["human", "system"],
      allowedAgentIds: [],
      projectScoped: true,
      governanceAction: "DATABASE_MIGRATION",
    },
  };

export const ENABLED_WRITE_ACTIONS: ExecutionActionId[] = (
  Object.keys(WRITE_ACTION_REGISTRY) as ExecutionActionId[]
).filter((id) => WRITE_ACTION_REGISTRY[id].enabled);

export const DISABLED_WRITE_ACTIONS: ExecutionActionId[] = (
  Object.keys(WRITE_ACTION_REGISTRY) as ExecutionActionId[]
).filter((id) => !WRITE_ACTION_REGISTRY[id].enabled);

export const REGISTERED_WRITE_MCP_TOOLS = ENABLED_WRITE_ACTIONS.map(
  (id) => WRITE_ACTION_REGISTRY[id].mcpToolName,
).filter((name): name is string => Boolean(name));

export function getWriteAction(action: string): WriteActionDefinition | undefined {
  return WRITE_ACTION_REGISTRY[action as ExecutionActionId];
}

export function isKnownWriteAction(action: string): action is ExecutionActionId {
  return action in WRITE_ACTION_REGISTRY;
}
