/**
 * Agent definition types — contract only, no LLM runtime.
 */

export const GOVERNANCE_PROFILES = ["read-only", "controlled-write"] as const;

export type GovernanceProfile = (typeof GOVERNANCE_PROFILES)[number];

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  role: string;
  allowedTools: string[];
  instructions: string;
  governanceProfile: GovernanceProfile;
  /** Absolute path to the agent directory (for diagnostics). */
  sourceDir: string;
}

/** Summary safe for MCP listing — no full instructions. */
export interface AgentSummary {
  id: string;
  name: string;
  role: string;
  governanceProfile: GovernanceProfile;
}

/**
 * Reserved for future explicit handoffs (no automatic spawning in v1).
 * Example: engineering-manager → developer → reviewer
 */
export interface AgentHandoffHint {
  fromAgentId: string;
  toAgentId: string;
  projectId: string;
  reason?: string;
}

export interface AgentExecutionContext {
  agentId: string;
  projectId: string;
  requestId?: string;
}

export interface AgentToolPermissionResult {
  allowed: boolean;
  agentId: string;
  toolName: string;
  reason: string;
}

export interface AgentYamlConfig {
  id: string;
  name: string;
  description: string;
  role: string;
  allowedTools: string[];
  governanceProfile: GovernanceProfile;
}
