import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GovernanceService } from "engineering-platform/governance";
import { GovernanceError } from "engineering-platform/governance";
import type { EngineeringTool } from "../types.js";
import type { ToolContext } from "../tool-context.js";

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function requireGovernance(context: ToolContext): GovernanceService {
  if (!context.governance) {
    throw new GovernanceError("Governance service is unavailable in this runtime.");
  }
  return context.governance;
}

function withReadPermission(tool: EngineeringTool): EngineeringTool {
  return {
    ...tool,
    execute: async (context, input) => {
      context.permissions.assertAllowed("READ");
      return tool.execute(context, input);
    },
  };
}

const checkPermissionSchema = z.object({
  projectId: z.string().trim().min(1, "projectId is required"),
  action: z.string().trim().min(1, "action is required"),
  context: z.record(z.string(), z.unknown()).optional(),
});

/**
 * READ-ONLY governance probe — does not execute mutating actions.
 */
export function createGovernanceTools(): EngineeringTool[] {
  return [
    withReadPermission({
      name: "engineering_check_permission",
      description:
        "Evaluate whether an action is ALLOW, HUMAN_APPROVAL, or DENY for a project. Fail-closed policy check — does not execute the action.",
      inputSchema: checkPermissionSchema,
      execute: async (context, input) => {
        const parsed = checkPermissionSchema.parse(input);
        const governance = requireGovernance(context);

        const evaluateContext = parsed.context
          ? normalizeContext(parsed.context)
          : undefined;

        const decision = governance.evaluate({
          projectId: parsed.projectId,
          action: parsed.action,
          requestId: context.requestId,
          actor: "mcp-agent",
          ...(evaluateContext !== undefined ? { context: evaluateContext } : {}),
        });

        return jsonResult({
          decision: decision.decision,
          action: decision.action,
          projectId: decision.projectId,
          riskLevel: decision.riskLevel,
          requiresApproval: decision.requiresApproval,
          reason: decision.reason,
        });
      },
    }),
  ];
}

export const GOVERNANCE_TOOL_NAMES = ["engineering_check_permission"] as const;

function normalizeContext(raw: Record<string, unknown>): {
  repository?: string;
  branch?: string;
  pullRequestNumber?: number;
  environment?: string;
  issueKey?: string;
  riskSignals?: string[];
} {
  const context: {
    repository?: string;
    branch?: string;
    pullRequestNumber?: number;
    environment?: string;
    issueKey?: string;
    riskSignals?: string[];
  } = {};

  if (typeof raw.repository === "string") {
    context.repository = raw.repository;
  }
  if (typeof raw.branch === "string") {
    context.branch = raw.branch;
  }
  if (typeof raw.pullRequestNumber === "number") {
    context.pullRequestNumber = raw.pullRequestNumber;
  }
  if (typeof raw.environment === "string") {
    context.environment = raw.environment;
  }
  if (typeof raw.issueKey === "string") {
    context.issueKey = raw.issueKey;
  }
  if (Array.isArray(raw.riskSignals) && raw.riskSignals.every((s) => typeof s === "string")) {
    context.riskSignals = raw.riskSignals as string[];
  }
  return context;
}
