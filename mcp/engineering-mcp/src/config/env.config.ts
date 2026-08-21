import { z } from "zod";
import { McpConfigurationError } from "../errors/mcp-errors.js";

const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === "boolean") {
      return value;
    }
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off", ""].includes(normalized)) {
      return false;
    }
    throw new Error(`Invalid boolean value: ${value}`);
  });

export const McpEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  MCP_SERVER_NAME: z.string().min(1).default("engineering-mcp"),
  MCP_SERVER_VERSION: z.string().min(1).default("0.1.0"),
  MCP_READ_ONLY: booleanFromEnv.default(true),
  MCP_ALLOW_JIRA_WRITE: booleanFromEnv.default(false),
  MCP_ALLOW_GITHUB_WRITE: booleanFromEnv.default(false),
  MCP_ALLOW_CONFLUENCE_WRITE: booleanFromEnv.default(false),
  PROJECTS_DIR: z.string().min(1).optional(),
});

export type McpEnvConfig = z.infer<typeof McpEnvSchema>;

export function loadMcpEnv(env: NodeJS.ProcessEnv = process.env): McpEnvConfig {
  const result = McpEnvSchema.safeParse({
    NODE_ENV: env.NODE_ENV,
    LOG_LEVEL: env.LOG_LEVEL,
    MCP_SERVER_NAME: env.MCP_SERVER_NAME,
    MCP_SERVER_VERSION: env.MCP_SERVER_VERSION,
    MCP_READ_ONLY: env.MCP_READ_ONLY,
    MCP_ALLOW_JIRA_WRITE: env.MCP_ALLOW_JIRA_WRITE,
    MCP_ALLOW_GITHUB_WRITE: env.MCP_ALLOW_GITHUB_WRITE,
    MCP_ALLOW_CONFLUENCE_WRITE: env.MCP_ALLOW_CONFLUENCE_WRITE,
    PROJECTS_DIR: env.PROJECTS_DIR,
  });

  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.map(String).join(".") ?? "unknown";
    const reason = issue?.message ?? "Invalid configuration";
    throw new McpConfigurationError(
      `Invalid MCP configuration for field "${field}": ${reason}`,
      { details: { field, reason } },
    );
  }

  return result.data;
}
