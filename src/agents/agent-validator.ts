import { z } from "zod";
import { AgentValidationError } from "./agent.errors.js";
import { GOVERNANCE_PROFILES, type AgentYamlConfig } from "./agent.types.js";

const GovernanceProfileSchema = z.enum(GOVERNANCE_PROFILES);

export const AgentYamlSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, "id must be kebab-case"),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  role: z.string().trim().min(1),
  allowedTools: z.array(z.string().trim().min(1)).min(1),
  governanceProfile: GovernanceProfileSchema,
});

export interface ValidateAgentOptions {
  knownTools: ReadonlySet<string>;
  /** Directory name must match agent id. */
  expectedIdFromDir?: string;
}

export function validateAgentYaml(
  raw: unknown,
  options: ValidateAgentOptions,
): AgentYamlConfig {
  const parsed = AgentYamlSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.map(String).join(".") || "(root)";
    throw new AgentValidationError(
      `Invalid agent.yaml: ${path}: ${issue?.message ?? "validation failed"}`,
    );
  }

  const config = parsed.data;

  if (options.expectedIdFromDir && options.expectedIdFromDir !== config.id) {
    throw new AgentValidationError(
      `Agent id "${config.id}" does not match directory "${options.expectedIdFromDir}".`,
      { details: { id: config.id, directory: options.expectedIdFromDir } },
    );
  }

  const unknownTools = config.allowedTools.filter((tool) => !options.knownTools.has(tool));
  if (unknownTools.length > 0) {
    throw new AgentValidationError(
      `Agent "${config.id}" references unknown tools: ${unknownTools.join(", ")}`,
      { details: { agentId: config.id, unknownTools } },
    );
  }

  const duplicates = findDuplicates(config.allowedTools);
  if (duplicates.length > 0) {
    throw new AgentValidationError(
      `Agent "${config.id}" has duplicate allowedTools: ${duplicates.join(", ")}`,
      { details: { agentId: config.id, duplicates } },
    );
  }

  if (config.governanceProfile === "read-only") {
    const writeLike = config.allowedTools.filter(isWriteLikeToolName);
    if (writeLike.length > 0) {
      throw new AgentValidationError(
        `Agent "${config.id}" is read-only but allowlists write-like tools: ${writeLike.join(", ")}`,
        { details: { agentId: config.id, writeLike } },
      );
    }
  }

  return config;
}

export function validateInstructions(instructions: string, agentId: string): string {
  const trimmed = instructions.trim();
  if (!trimmed) {
    throw new AgentValidationError(`Agent "${agentId}" has empty instructions.md`);
  }
  return trimmed;
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      dupes.add(value);
    }
    seen.add(value);
  }
  return [...dupes];
}

/**
 * Heuristic guard for read-only profiles. Not a substitute for Governance.
 */
export function isWriteLikeToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return (
    name.includes("create") ||
    name.includes("update") ||
    name.includes("delete") ||
    name.includes("merge") ||
    name.includes("deploy") ||
    name.includes("write") ||
    name.includes("execute_shell")
  );
}
