import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AgentService } from "engineering-platform/agents";
import { EngineeringError } from "../../services/engineering/engineering.errors.js";
import type { EngineeringService } from "../../services/engineering/engineering.service.js";
import type { EngineeringTool } from "../types.js";
import type { ToolContext } from "../tool-context.js";
import type { WorkflowService } from "engineering-platform/workflows";

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function requireEngineering(context: ToolContext): EngineeringService {
  if (!context.engineering) {
    throw new EngineeringError("Engineering Intelligence service is unavailable in this runtime.", {
      code: "ENGINEERING_ERROR",
    });
  }
  return context.engineering;
}

function requireAgents(context: ToolContext): AgentService {
  if (!context.agents) {
    throw new EngineeringError("Agent service is unavailable in this runtime.", {
      code: "ENGINEERING_ERROR",
    });
  }
  return context.agents;
}

function requireWorkflows(context: ToolContext): WorkflowService {
  if (!context.workflows) {
    throw new EngineeringError("Workflow service is unavailable in this runtime.", {
      code: "ENGINEERING_ERROR",
    });
  }
  return context.workflows;
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

const projectIdSchema = z.string().trim().min(1, "projectId is required");

const projectOnlySchema = z.object({
  projectId: projectIdSchema,
});

const sprintStatusSchema = z.object({
  projectId: projectIdSchema,
  sprintId: z.number().int().positive().optional(),
});

const staleWorkSchema = z.object({
  projectId: projectIdSchema,
  staleDays: z.number().int().min(1).max(365).optional(),
});

const prStatusSchema = z.object({
  projectId: projectIdSchema,
  repository: z.string().trim().min(1).optional(),
  state: z.enum(["open", "closed", "all"]).optional().default("open"),
});

export function createEngineeringTools(): EngineeringTool[] {
  return [
    withReadPermission({
      name: "engineering_get_project_status",
      description:
        "Aggregate project engineering status from Jira, GitHub, and Confluence. Degrades gracefully when a source is unavailable.",
      inputSchema: projectOnlySchema,
      execute: async (context, input) => {
        const parsed = projectOnlySchema.parse(input);
        return jsonResult(await requireEngineering(context).getProjectStatus(parsed.projectId));
      },
    }),
    withReadPermission({
      name: "engineering_get_sprint_status",
      description:
        "Sprint progress for a project. Pass sprintId for full metadata; otherwise loads tickets in openSprints.",
      inputSchema: sprintStatusSchema,
      execute: async (context, input) => {
        const parsed = sprintStatusSchema.parse(input);
        return jsonResult(
          await requireEngineering(context).getSprintStatus(parsed.projectId, parsed.sprintId),
        );
      },
    }),
    withReadPermission({
      name: "engineering_get_team_status",
      description:
        "Operational team workload and delivery activity (not a performance ranking).",
      inputSchema: projectOnlySchema,
      execute: async (context, input) => {
        const parsed = projectOnlySchema.parse(input);
        return jsonResult(await requireEngineering(context).getTeamStatus(parsed.projectId));
      },
    }),
    withReadPermission({
      name: "engineering_get_delivery_status",
      description: "Aggregate delivery status from Jira work items and GitHub pull requests.",
      inputSchema: projectOnlySchema,
      execute: async (context, input) => {
        const parsed = projectOnlySchema.parse(input);
        return jsonResult(await requireEngineering(context).getDeliveryStatus(parsed.projectId));
      },
    }),
    withReadPermission({
      name: "engineering_get_stale_work",
      description: "List non-done Jira issues that have not been updated for staleDays (default 7).",
      inputSchema: staleWorkSchema,
      execute: async (context, input) => {
        const parsed = staleWorkSchema.parse(input);
        return jsonResult(
          await requireEngineering(context).getStaleWork(parsed.projectId, parsed.staleDays),
        );
      },
    }),
    withReadPermission({
      name: "engineering_get_blocked_work",
      description:
        "List explicitly blocked Jira issues (status/label/summary signals only — not age-based).",
      inputSchema: projectOnlySchema,
      execute: async (context, input) => {
        const parsed = projectOnlySchema.parse(input);
        return jsonResult(await requireEngineering(context).getBlockedWork(parsed.projectId));
      },
    }),
    withReadPermission({
      name: "engineering_get_pr_status",
      description:
        "Pull request status with review/CI signals, Jira key correlation, and deterministic risk levels.",
      inputSchema: prStatusSchema,
      execute: async (context, input) => {
        const parsed = prStatusSchema.parse(input);
        return jsonResult(
          await requireEngineering(context).getPRStatus(parsed.projectId, {
            ...(parsed.repository !== undefined ? { repository: parsed.repository } : {}),
            state: parsed.state,
          }),
        );
      },
    }),
    withReadPermission({
      name: "engineering_get_risk_report",
      description:
        "Deterministic engineering risk report with evidence references (no LLM scoring).",
      inputSchema: projectOnlySchema,
      execute: async (context, input) => {
        const parsed = projectOnlySchema.parse(input);
        return jsonResult(await requireEngineering(context).getRiskReport(parsed.projectId));
      },
    }),
    withReadPermission({
      name: "engineering_list_agents",
      description:
        "List configured platform agents (id, name, role, governanceProfile). Does not expose full instructions.",
      inputSchema: z.object({}),
      execute: async (context) => {
        const agents = requireAgents(context).listAgents();
        return jsonResult({ agents });
      },
    }),
    withReadPermission({
      name: "engineering_list_workflows",
      description:
        "List configured workflows (id, name, version, description, stepCount). READ-ONLY.",
      inputSchema: z.object({}),
      execute: async (context) => {
        const workflows = requireWorkflows(context).listWorkflows();
        return jsonResult({ workflows });
      },
    }),
    withReadPermission({
      name: "engineering_get_workflow",
      description:
        "Get a workflow definition summary and step outline. Does not execute the workflow.",
      inputSchema: z.object({
        workflowId: z.string().trim().min(1),
      }),
      execute: async (context, input) => {
        const parsed = z.object({ workflowId: z.string().trim().min(1) }).parse(input);
        const wf = requireWorkflows(context).getWorkflow(parsed.workflowId);
        return jsonResult({
          id: wf.id,
          name: wf.name,
          description: wf.description,
          version: wf.version,
          trigger: wf.trigger,
          steps: wf.steps.map((s) => ({
            id: s.id,
            type: s.type,
            agent: s.agent,
            action: s.action,
            condition: s.condition,
            enabled: s.enabled ?? true,
            dependsOn: s.dependsOn ?? [],
          })),
        });
      },
    }),
    withReadPermission({
      name: "engineering_get_workflow_instance",
      description:
        "Get a workflow instance status snapshot (observability). Does not execute steps.",
      inputSchema: z.object({
        instanceId: z.string().trim().min(1),
      }),
      execute: async (context, input) => {
        const parsed = z.object({ instanceId: z.string().trim().min(1) }).parse(input);
        return jsonResult(requireWorkflows(context).getObservability(parsed.instanceId));
      },
    }),
  ];
}

export const ENGINEERING_TOOL_NAMES = [
  "engineering_get_project_status",
  "engineering_get_sprint_status",
  "engineering_get_team_status",
  "engineering_get_delivery_status",
  "engineering_get_stale_work",
  "engineering_get_blocked_work",
  "engineering_get_pr_status",
  "engineering_get_risk_report",
  "engineering_list_agents",
  "engineering_list_workflows",
  "engineering_get_workflow",
  "engineering_get_workflow_instance",
] as const;
