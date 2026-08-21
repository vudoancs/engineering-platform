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

function assertJiraWriteEnabled(context: ToolContext): void {
  if (!context.config.MCP_ALLOW_JIRA_WRITE) {
    throw new ExecutionError(
      "Jira write tools are disabled (set MCP_ALLOW_JIRA_WRITE=true)",
      { code: "ACTION_NOT_ALLOWED" },
    );
  }
}

const updateSchema = z.object({
  projectId: z.string().trim().min(1),
  issueKey: z.string().trim().min(1),
  fields: z
    .object({
      status: z.string().trim().min(1).optional(),
      comment: z.string().trim().min(1).optional(),
      labels: z.array(z.string().trim().min(1)).optional(),
    })
    .strict(),
  approvalRequestId: z.string().trim().min(1).optional(),
  dryRun: z.boolean().optional(),
  workflowInstanceId: z.string().trim().min(1).optional(),
  stepId: z.string().trim().min(1).optional(),
  reason: z.string().trim().min(1).optional(),
});

export function createJiraWriteTools(): EngineeringTool[] {
  return [
    {
      name: "jira_update_issue",
      description:
        "Controlled write: update Jira issue fields (status, comment, labels only). Requires approval. Rejects assignee/priority/story points/sprint.",
      inputSchema: updateSchema,
      execute: async (context, input) => {
        assertJiraWriteEnabled(context);
        const parsed = updateSchema.parse(input);
        if (
          input &&
          typeof input === "object" &&
          ("accessToken" in input || "apiKey" in input || "apiToken" in input)
        ) {
          throw new ExecutionError("Do not pass credentials to MCP tools", {
            code: "INVALID_PARAMETERS",
          });
        }

        const execution = requireExecution(context);
        const result = await execution.execute({
          requestId: randomUUID(),
          projectId: parsed.projectId,
          actor: { type: "human", id: "mcp-caller" },
          ...(parsed.workflowInstanceId
            ? { workflowInstanceId: parsed.workflowInstanceId }
            : {}),
          ...(parsed.stepId ? { stepId: parsed.stepId } : {}),
          action: "jira.update_issue",
          resource: { issueKey: parsed.issueKey },
          parameters: {
            issueKey: parsed.issueKey,
            fields: parsed.fields,
          },
          reason: parsed.reason ?? "Update Jira issue via MCP",
          ...(parsed.approvalRequestId
            ? { approvalRequestId: parsed.approvalRequestId }
            : {}),
          ...(parsed.dryRun !== undefined ? { dryRun: parsed.dryRun } : {}),
        });

        return jsonResult(result);
      },
    },
  ];
}

export const JIRA_WRITE_TOOL_NAMES = ["jira_update_issue"] as const;
