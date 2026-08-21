import { AgentLoader, type AgentLoaderOptions } from "./agent-loader.js";
import { AgentNotFoundError } from "./agent.errors.js";
import { AgentPolicy, type AgentPolicyOptions } from "./agent-policy.js";
import type {
  AgentDefinition,
  AgentSummary,
  AgentToolPermissionResult,
} from "./agent.types.js";
import { DEFAULT_KNOWN_MCP_TOOLS } from "./known-tools.js";

export interface AgentServiceOptions {
  agentsDir: string;
  knownTools?: ReadonlySet<string> | readonly string[];
  policy?: AgentPolicyOptions;
}

/**
 * Agent definition + policy layer.
 * Does not run an LLM or autonomous loop.
 */
export class AgentService {
  private readonly agents: Map<string, AgentDefinition>;
  private readonly policy: AgentPolicy;
  private readonly agentsDir: string;

  constructor(options: AgentServiceOptions) {
    this.agentsDir = options.agentsDir;
    const loader = new AgentLoader({
      agentsDir: options.agentsDir,
      knownTools: options.knownTools ?? DEFAULT_KNOWN_MCP_TOOLS,
    });
    const loaded = loader.loadAll();
    this.agents = new Map(loaded.map((agent) => [agent.id, agent]));
    this.policy = new AgentPolicy(options.policy ?? {});

    for (const agent of loaded) {
      this.policy.assertGovernanceProfile(agent.governanceProfile, agent.id);
    }
  }

  static loadFromDirectory(options: AgentServiceOptions): AgentService {
    return new AgentService(options);
  }

  listAgents(): AgentSummary[] {
    return [...this.agents.values()]
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        governanceProfile: agent.governanceProfile,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  getAgent(agentId: string): AgentDefinition {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AgentNotFoundError(agentId);
    }
    return agent;
  }

  validateAgent(agentId: string): { valid: true; agentId: string } {
    // Throws if missing / inconsistent; reload path validates YAML on construction.
    const agent = this.getAgent(agentId);
    this.policy.assertGovernanceProfile(agent.governanceProfile, agent.id);
    return { valid: true, agentId: agent.id };
  }

  getAllowedTools(agentId: string): string[] {
    return [...this.getAgent(agentId).allowedTools];
  }

  getInstructions(agentId: string): string {
    return this.getAgent(agentId).instructions;
  }

  checkToolPermission(agentId: string, toolName: string): AgentToolPermissionResult {
    const agent = this.getAgent(agentId);
    return this.policy.checkToolPermission(agent, toolName);
  }

  assertToolAllowed(agentId: string, toolName: string): void {
    const agent = this.getAgent(agentId);
    this.policy.assertToolAllowed(agent, toolName);
  }

  assertProjectContext(projectId: string): void {
    this.policy.assertProjectContext(projectId);
  }

  getAgentsDir(): string {
    return this.agentsDir;
  }

  /**
   * Create a loader options object for tests / MCP wiring.
   */
  static defaultLoaderOptions(agentsDir: string): AgentLoaderOptions {
    return {
      agentsDir,
      knownTools: DEFAULT_KNOWN_MCP_TOOLS,
    };
  }
}
