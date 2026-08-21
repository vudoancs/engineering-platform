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

function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export const McpEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    MCP_SERVER_NAME: z.string().min(1).default("engineering-mcp"),
    MCP_SERVER_VERSION: z.string().min(1).default("0.1.0"),
    MCP_READ_ONLY: booleanFromEnv.default(true),
    MCP_ALLOW_JIRA_WRITE: booleanFromEnv.default(false),
    MCP_ALLOW_GITHUB_WRITE: booleanFromEnv.default(false),
    MCP_ALLOW_CONFLUENCE_WRITE: booleanFromEnv.default(false),
    PROJECTS_DIR: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    JIRA_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    JIRA_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
    JIRA_API_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    JIRA_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  })
  .superRefine((value, ctx) => {
    const present = [value.JIRA_BASE_URL, value.JIRA_EMAIL, value.JIRA_API_TOKEN].filter(
      Boolean,
    ).length;
    if (present > 0 && present < 3) {
      ctx.addIssue({
        code: "custom",
        message:
          "JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN must all be set together (or all omitted)",
        path: ["JIRA_BASE_URL"],
      });
    }
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
    JIRA_BASE_URL: env.JIRA_BASE_URL,
    JIRA_EMAIL: env.JIRA_EMAIL,
    JIRA_API_TOKEN: env.JIRA_API_TOKEN,
    JIRA_REQUEST_TIMEOUT_MS: env.JIRA_REQUEST_TIMEOUT_MS,
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

export function hasJiraCredentials(config: McpEnvConfig): boolean {
  return Boolean(config.JIRA_BASE_URL && config.JIRA_EMAIL && config.JIRA_API_TOKEN);
}
