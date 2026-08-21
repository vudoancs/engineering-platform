import type { GovernanceService } from "../governance/governance.service.js";
import {
  AgentProjectDeniedError,
  AgentToolDeniedError,
  AgentValidationError,
} from "./agent.errors.js";
import { isWriteLikeToolName } from "./agent-validator.js";
import type {
  AgentDefinition,
  AgentToolPermissionResult,
  GovernanceProfile,
} from "./agent.types.js";

export type ProjectExistenceChecker = (projectId: string) => boolean;

export interface AgentPolicyOptions {
  /** Optional GovernanceService for future write evaluation. */
  governance?: GovernanceService | null;
  isProjectKnown?: ProjectExistenceChecker;
}

/**
 * Runtime enforcement for agent tool allowlists + project context.
 * Prompt instructions are not security — this code is.
 */
export class AgentPolicy {
  private readonly governance: GovernanceService | null;
  private readonly isProjectKnown?: ProjectExistenceChecker;

  constructor(options: AgentPolicyOptions = {}) {
    this.governance = options.governance ?? null;
    if (options.isProjectKnown) {
      this.isProjectKnown = options.isProjectKnown;
    }
  }

  assertProjectContext(projectId: string): void {
    const trimmed = projectId?.trim() ?? "";
    if (!trimmed) {
      throw new AgentProjectDeniedError("(missing)", "projectId is required");
    }
    if (this.isProjectKnown && !this.isProjectKnown(trimmed)) {
      throw new AgentProjectDeniedError(
        trimmed,
        `Unknown project "${trimmed}" (fail closed)`,
      );
    }
  }

  checkToolPermission(agent: AgentDefinition, toolName: string): AgentToolPermissionResult {
    const tool = toolName.trim();
    if (!tool) {
      return {
        allowed: false,
        agentId: agent.id,
        toolName: toolName || "(missing)",
        reason: "toolName is required",
      };
    }

    if (!agent.allowedTools.includes(tool)) {
      return {
        allowed: false,
        agentId: agent.id,
        toolName: tool,
        reason: `Tool "${tool}" is not in agent "${agent.id}" allowlist`,
      };
    }

    if (agent.governanceProfile === "read-only" && isWriteLikeToolName(tool)) {
      return {
        allowed: false,
        agentId: agent.id,
        toolName: tool,
        reason: `Tool "${tool}" is write-like but agent "${agent.id}" is read-only`,
      };
    }

    // Future write path: Agent → Governance → Approval → execution.
    // Read-only agents never reach write ActionTypes here.
    if (this.governance && agent.governanceProfile !== "read-only") {
      // Reserved for future mutating governance profiles.
    }

    return {
      allowed: true,
      agentId: agent.id,
      toolName: tool,
      reason: `Tool "${tool}" is allowed for agent "${agent.id}"`,
    };
  }

  assertToolAllowed(agent: AgentDefinition, toolName: string): void {
    const result = this.checkToolPermission(agent, toolName);
    if (!result.allowed) {
      throw new AgentToolDeniedError(agent.id, result.toolName, result.reason);
    }
  }

  assertGovernanceProfile(profile: GovernanceProfile, agentId: string): void {
    if (profile !== "read-only" && profile !== "controlled-write") {
      throw new AgentValidationError(
        `Unsupported governanceProfile "${profile}" for agent "${agentId}"`,
      );
    }
  }
}
