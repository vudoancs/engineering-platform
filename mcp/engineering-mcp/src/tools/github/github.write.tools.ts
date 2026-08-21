import { randomUUID } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  ExecutionError,
  type ExecutionService,
} from "engineering-platform/execution";
import { z } from "zod";
import type { EngineeringTool } from "../types.js";
import type { ToolContext } from "../tool-context.js";

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function requireExecution(context: ToolContext): ExecutionService {
  if (!context.execution) {
    throw new ExecutionError("Execution service is unavailable in this runtime.");
  }
  return context.execution;
}

function assertGitHubWriteEnabled(context: ToolContext): void {
  if (!context.config.MCP_ALLOW_GITHUB_WRITE) {
    throw new ExecutionError(
      "GitHub write tools are disabled (set MCP_ALLOW_GITHUB_WRITE=true)",
      { code: "ACTION_NOT_ALLOWED" },
    );
  }
}

const branchSchema = z.object({
  projectId: z.string().trim().min(1),
  branchName: z.string().trim().min(1).max(255),
  baseBranch: z.string().trim().min(1).max(255),
  dryRun: z.boolean().optional(),
  agentId: z.string().trim().min(1).optional(),
  workflowInstanceId: z.string().trim().min(1).optional(),
  stepId: z.string().trim().min(1).optional(),
  reason: z.string().trim().min(1).optional(),
});

const prSchema = z.object({
  projectId: z.string().trim().min(1),
  headBranch: z.string().trim().min(1).max(255),
  baseBranch: z.string().trim().min(1).max(255),
  title: z.string().trim().min(1).max(256),
  body: z.string().max(65_536).default(""),
  dryRun: z.boolean().optional(),
  agentId: z.string().trim().min(1).optional(),
  workflowInstanceId: z.string().trim().min(1).optional(),
  stepId: z.string().trim().min(1).optional(),
  reason: z.string().trim().min(1).optional(),
});

export function createGitHubWriteTools(): EngineeringTool[] {
  return [
    {
      name: "github_create_branch",
      description:
        "Controlled write: create a GitHub branch. Repository is resolved from project config (not caller-authoritative).",
      inputSchema: branchSchema,
      execute: async (context, input) => {
        assertGitHubWriteEnabled(context);
        const parsed = branchSchema.parse(input);
        // Reject credential / repository authority attempts
        if (
          input &&
          typeof input === "object" &&
          ("repository" in input ||
            "accessToken" in input ||
            "apiKey" in input ||
            "repositoryUrl" in input)
        ) {
          throw new ExecutionError(
            "Do not pass repository or credentials; repository is resolved from project config",
            { code: "INVALID_PARAMETERS" },
          );
        }

        const execution = requireExecution(context);
        const repository = execution
          .getGuard()
          .resolveRepository(parsed.projectId);

        const result = await execution.execute({
          requestId: randomUUID(),
          projectId: parsed.projectId,
          actor: {
            type: parsed.agentId ? "agent" : "human",
            id: parsed.agentId ?? "mcp-caller",
          },
          ...(parsed.agentId ? { agentId: parsed.agentId } : {}),
          ...(parsed.workflowInstanceId
            ? { workflowInstanceId: parsed.workflowInstanceId }
            : {}),
          ...(parsed.stepId ? { stepId: parsed.stepId } : {}),
          action: "github.create_branch",
          resource: { repository, branchName: parsed.branchName },
          parameters: {
            branchName: parsed.branchName,
            baseBranch: parsed.baseBranch,
          },
          reason: parsed.reason ?? "Create branch via MCP",
          ...(parsed.dryRun !== undefined ? { dryRun: parsed.dryRun } : {}),
        });

        return jsonResult(result);
      },
    },
    {
      name: "github_create_pull_request",
      description:
        "Controlled write: create a GitHub pull request. Repository resolved from project config. Does not merge.",
      inputSchema: prSchema,
      execute: async (context, input) => {
        assertGitHubWriteEnabled(context);
        const parsed = prSchema.parse(input);
        if (
          input &&
          typeof input === "object" &&
          ("repository" in input ||
            "accessToken" in input ||
            "apiKey" in input ||
            "repositoryUrl" in input)
        ) {
          throw new ExecutionError(
            "Do not pass repository or credentials; repository is resolved from project config",
            { code: "INVALID_PARAMETERS" },
          );
        }

        const execution = requireExecution(context);
        const repository = execution
          .getGuard()
          .resolveRepository(parsed.projectId);

        const result = await execution.execute({
          requestId: randomUUID(),
          projectId: parsed.projectId,
          actor: {
            type: parsed.agentId ? "agent" : "human",
            id: parsed.agentId ?? "mcp-caller",
          },
          ...(parsed.agentId ? { agentId: parsed.agentId } : {}),
          ...(parsed.workflowInstanceId
            ? { workflowInstanceId: parsed.workflowInstanceId }
            : {}),
          ...(parsed.stepId ? { stepId: parsed.stepId } : {}),
          action: "github.create_pull_request",
          resource: { repository, branchName: parsed.headBranch },
          parameters: {
            headBranch: parsed.headBranch,
            baseBranch: parsed.baseBranch,
            title: parsed.title,
            body: parsed.body,
          },
          reason: parsed.reason ?? "Create pull request via MCP",
          ...(parsed.dryRun !== undefined ? { dryRun: parsed.dryRun } : {}),
        });

        return jsonResult(result);
      },
    },
  ];
}

export const GITHUB_WRITE_TOOL_NAMES = [
  "github_create_branch",
  "github_create_pull_request",
] as const;
