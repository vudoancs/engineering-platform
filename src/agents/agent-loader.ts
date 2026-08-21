import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { AgentConfigurationError } from "./agent.errors.js";
import {
  validateAgentYaml,
  validateInstructions,
} from "./agent-validator.js";
import type { AgentDefinition } from "./agent.types.js";
import { DEFAULT_KNOWN_MCP_TOOLS } from "./known-tools.js";

export interface AgentLoaderOptions {
  agentsDir: string;
  knownTools?: ReadonlySet<string> | readonly string[];
}

/**
 * Loads agent.yaml + instructions.md from agents/<id>/.
 * Invalid agents fail immediately (no silent skip).
 */
export class AgentLoader {
  private readonly agentsDir: string;
  private readonly knownTools: ReadonlySet<string>;

  constructor(options: AgentLoaderOptions) {
    this.agentsDir = path.resolve(options.agentsDir);
    this.knownTools = toToolSet(options.knownTools ?? DEFAULT_KNOWN_MCP_TOOLS);
  }

  loadAll(): AgentDefinition[] {
    if (!fs.existsSync(this.agentsDir)) {
      throw new AgentConfigurationError(
        `Agents directory not found: ${this.agentsDir}`,
        { details: { agentsDir: this.agentsDir } },
      );
    }

    const entries = fs.readdirSync(this.agentsDir, { withFileTypes: true });
    const dirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith("."))
      .sort();

    const agents: AgentDefinition[] = [];
    for (const dirName of dirs) {
      const agentDir = path.join(this.agentsDir, dirName);
      if (!fs.existsSync(path.join(agentDir, "agent.yaml"))) {
        // Placeholder folders (README-only) are ignored until agent.yaml exists.
        continue;
      }
      agents.push(this.loadOne(dirName));
    }

    if (agents.length === 0) {
      throw new AgentConfigurationError(
        `No agents with agent.yaml found under ${this.agentsDir}`,
        { details: { agentsDir: this.agentsDir } },
      );
    }

    const ids = new Set<string>();
    for (const agent of agents) {
      if (ids.has(agent.id)) {
        throw new AgentConfigurationError(`Duplicate agent id "${agent.id}"`);
      }
      ids.add(agent.id);
    }

    return agents;
  }

  loadOne(dirName: string): AgentDefinition {
    const agentDir = path.join(this.agentsDir, dirName);
    const yamlPath = path.join(agentDir, "agent.yaml");
    const instructionsPath = path.join(agentDir, "instructions.md");

    if (!fs.existsSync(yamlPath)) {
      throw new AgentConfigurationError(`Missing agent.yaml in ${agentDir}`);
    }
    if (!fs.existsSync(instructionsPath)) {
      throw new AgentConfigurationError(`Missing instructions.md in ${agentDir}`);
    }

    let raw: unknown;
    try {
      raw = parseYaml(fs.readFileSync(yamlPath, "utf8"));
    } catch (error) {
      throw new AgentConfigurationError(`Failed to parse agent.yaml in ${agentDir}`, {
        cause: error,
      });
    }

    const config = validateAgentYaml(raw, {
      knownTools: this.knownTools,
      expectedIdFromDir: dirName,
    });

    let instructionsText: string;
    try {
      instructionsText = fs.readFileSync(instructionsPath, "utf8");
    } catch (error) {
      throw new AgentConfigurationError(
        `Failed to read instructions.md for agent "${config.id}"`,
        { cause: error },
      );
    }

    const instructions = validateInstructions(instructionsText, config.id);

    return {
      id: config.id,
      name: config.name,
      description: config.description,
      role: config.role,
      allowedTools: [...config.allowedTools],
      instructions,
      governanceProfile: config.governanceProfile,
      sourceDir: agentDir,
    };
  }
}

function toToolSet(tools: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  return tools instanceof Set ? tools : new Set(tools);
}
