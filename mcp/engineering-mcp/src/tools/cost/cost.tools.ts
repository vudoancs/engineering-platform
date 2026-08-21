import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  CostError,
  type CostGovernance,
  type CostViewer,
  type PeriodPreset,
} from "engineering-platform/cost";
import { z } from "zod";
import type { EngineeringTool } from "../types.js";
import type { ToolContext } from "../tool-context.js";

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function requireCost(context: ToolContext): CostGovernance {
  if (!context.cost) {
    throw new CostError("Cost governance is unavailable in this runtime.");
  }
  return context.cost;
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

const periodSchema = z.enum(["day", "week", "month"]).default("day");

const viewerSchema = z.object({
  role: z.enum(["engineering-manager", "developer", "reviewer", "system"]),
  memberId: z.string().trim().min(1).optional(),
});

function viewerFrom(input: {
  role: CostViewer["role"];
  memberId?: string;
}): CostViewer {
  return {
    role: input.role,
    ...(input.memberId !== undefined ? { memberId: input.memberId } : {}),
  };
}

const usageSchema = z.object({
  period: periodSchema,
  projectId: z.string().trim().min(1).optional(),
  memberId: z.string().trim().min(1).optional(),
  agentId: z.string().trim().min(1).optional(),
  provider: z.string().trim().min(1).optional(),
  viewerRole: z
    .enum(["engineering-manager", "developer", "reviewer", "system"])
    .default("engineering-manager"),
  viewerMemberId: z.string().trim().min(1).optional(),
});

export function createCostTools(): EngineeringTool[] {
  return [
    withReadPermission({
      name: "engineering_get_ai_usage",
      description:
        "READ-ONLY: AI usage summary (tokens + cost) for a period. Scoped by auth role.",
      inputSchema: usageSchema,
      execute: async (context, input) => {
        const cost = requireCost(context);
        const parsed = usageSchema.parse(input);
        const viewer = viewerFrom({
          role: parsed.viewerRole,
          ...(parsed.viewerMemberId !== undefined
            ? { memberId: parsed.viewerMemberId }
            : {}),
        });
        const { summary } = cost.getReport(viewer, {
          period: parsed.period as PeriodPreset,
          ...(parsed.projectId !== undefined ? { projectId: parsed.projectId } : {}),
          ...(parsed.memberId !== undefined ? { memberId: parsed.memberId } : {}),
          ...(parsed.agentId !== undefined ? { agentId: parsed.agentId } : {}),
          ...(parsed.provider !== undefined ? { provider: parsed.provider } : {}),
        });
        return jsonResult(summary);
      },
    }),
    withReadPermission({
      name: "engineering_get_ai_cost",
      description: "READ-ONLY: formatted AI cost report for managers or own usage.",
      inputSchema: usageSchema,
      execute: async (context, input) => {
        const cost = requireCost(context);
        const parsed = usageSchema.parse(input);
        const viewer = viewerFrom({
          role: parsed.viewerRole,
          ...(parsed.viewerMemberId !== undefined
            ? { memberId: parsed.viewerMemberId }
            : {}),
        });
        const { summary, text } = cost.getReport(viewer, {
          period: parsed.period as PeriodPreset,
          ...(parsed.projectId !== undefined ? { projectId: parsed.projectId } : {}),
          ...(parsed.memberId !== undefined ? { memberId: parsed.memberId } : {}),
        });
        return jsonResult({ summary, report: text });
      },
    }),
    withReadPermission({
      name: "engineering_get_ai_budget",
      description: "READ-ONLY: remaining AI budget for global/project/agent/member.",
      inputSchema: z.object({
        scope: z.enum(["GLOBAL", "PROJECT", "MEMBER", "AGENT"]).default("GLOBAL"),
        scopeId: z.string().trim().min(1).default("global"),
        period: periodSchema,
        viewerRole: viewerSchema.shape.role.default("engineering-manager"),
        viewerMemberId: z.string().trim().min(1).optional(),
      }),
      execute: async (context, input) => {
        const cost = requireCost(context);
        const parsed = z
          .object({
            scope: z.enum(["GLOBAL", "PROJECT", "MEMBER", "AGENT"]).default("GLOBAL"),
            scopeId: z.string().trim().min(1).default("global"),
            period: periodSchema,
            viewerRole: viewerSchema.shape.role.default("engineering-manager"),
            viewerMemberId: z.string().trim().min(1).optional(),
          })
          .parse(input);
        const viewer = viewerFrom({
          role: parsed.viewerRole,
          ...(parsed.viewerMemberId !== undefined
            ? { memberId: parsed.viewerMemberId }
            : {}),
        });
        if (parsed.scope === "GLOBAL") cost.authorization.assertCanViewGlobal(viewer);
        if (parsed.scope === "PROJECT") {
          cost.authorization.assertCanViewProject(viewer, parsed.scopeId);
        }
        if (parsed.scope === "MEMBER") {
          cost.authorization.assertCanViewMember(viewer, parsed.scopeId);
        }
        if (parsed.scope === "AGENT") {
          cost.authorization.assertCanViewAgent(viewer, parsed.scopeId);
        }
        return jsonResult(
          cost.budgetService.snapshot(
            parsed.scope,
            parsed.scopeId,
            parsed.period as PeriodPreset,
          ),
        );
      },
    }),
    withReadPermission({
      name: "engineering_get_ai_cost_by_project",
      description: "READ-ONLY: AI cost breakdown by project.",
      inputSchema: z.object({
        period: periodSchema,
        projectId: z.string().trim().min(1).optional(),
        viewerRole: viewerSchema.shape.role.default("engineering-manager"),
        viewerMemberId: z.string().trim().min(1).optional(),
      }),
      execute: async (context, input) => {
        const cost = requireCost(context);
        const parsed = z
          .object({
            period: periodSchema,
            projectId: z.string().trim().min(1).optional(),
            viewerRole: viewerSchema.shape.role.default("engineering-manager"),
            viewerMemberId: z.string().trim().min(1).optional(),
          })
          .parse(input);
        const viewer = viewerFrom({
          role: parsed.viewerRole,
          ...(parsed.viewerMemberId !== undefined
            ? { memberId: parsed.viewerMemberId }
            : {}),
        });
        const { summary } = cost.getReport(viewer, {
          period: parsed.period as PeriodPreset,
          ...(parsed.projectId !== undefined ? { projectId: parsed.projectId } : {}),
        });
        return jsonResult({ period: parsed.period, byProject: summary.byProject });
      },
    }),
    withReadPermission({
      name: "engineering_get_ai_cost_by_agent",
      description: "READ-ONLY: AI cost breakdown by agent.",
      inputSchema: z.object({
        period: periodSchema,
        agentId: z.string().trim().min(1).optional(),
        viewerRole: viewerSchema.shape.role.default("engineering-manager"),
      }),
      execute: async (context, input) => {
        const cost = requireCost(context);
        const parsed = z
          .object({
            period: periodSchema,
            agentId: z.string().trim().min(1).optional(),
            viewerRole: viewerSchema.shape.role.default("engineering-manager"),
          })
          .parse(input);
        const viewer = viewerFrom({ role: parsed.viewerRole });
        const { summary } = cost.getReport(viewer, {
          period: parsed.period as PeriodPreset,
          ...(parsed.agentId !== undefined ? { agentId: parsed.agentId } : {}),
        });
        return jsonResult({ period: parsed.period, byAgent: summary.byAgent });
      },
    }),
    withReadPermission({
      name: "engineering_get_ai_cost_by_member",
      description: "READ-ONLY: AI cost by member (own usage for developers).",
      inputSchema: z.object({
        period: periodSchema,
        memberId: z.string().trim().min(1),
        viewerRole: viewerSchema.shape.role.default("engineering-manager"),
        viewerMemberId: z.string().trim().min(1).optional(),
      }),
      execute: async (context, input) => {
        const cost = requireCost(context);
        const parsed = z
          .object({
            period: periodSchema,
            memberId: z.string().trim().min(1),
            viewerRole: viewerSchema.shape.role.default("engineering-manager"),
            viewerMemberId: z.string().trim().min(1).optional(),
          })
          .parse(input);
        const viewer = viewerFrom({
          role: parsed.viewerRole,
          ...(parsed.viewerMemberId !== undefined
            ? { memberId: parsed.viewerMemberId }
            : {}),
        });
        const { summary } = cost.getReport(viewer, {
          period: parsed.period as PeriodPreset,
          memberId: parsed.memberId,
        });
        return jsonResult({ period: parsed.period, byMember: summary.byMember });
      },
    }),
    withReadPermission({
      name: "engineering_get_ai_cost_by_provider",
      description: "READ-ONLY: AI cost by provider/model.",
      inputSchema: z.object({
        period: periodSchema,
        provider: z.string().trim().min(1).optional(),
        viewerRole: viewerSchema.shape.role.default("engineering-manager"),
      }),
      execute: async (context, input) => {
        const cost = requireCost(context);
        const parsed = z
          .object({
            period: periodSchema,
            provider: z.string().trim().min(1).optional(),
            viewerRole: viewerSchema.shape.role.default("engineering-manager"),
          })
          .parse(input);
        const viewer = viewerFrom({ role: parsed.viewerRole });
        const { summary } = cost.getReport(viewer, {
          period: parsed.period as PeriodPreset,
          ...(parsed.provider !== undefined ? { provider: parsed.provider } : {}),
        });
        return jsonResult({
          period: parsed.period,
          byProvider: summary.byProvider,
          byModel: summary.byModel,
        });
      },
    }),
  ];
}

export const COST_TOOL_NAMES = [
  "engineering_get_ai_usage",
  "engineering_get_ai_cost",
  "engineering_get_ai_budget",
  "engineering_get_ai_cost_by_project",
  "engineering_get_ai_cost_by_agent",
  "engineering_get_ai_cost_by_member",
  "engineering_get_ai_cost_by_provider",
] as const;
