import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { JiraError } from "../../integrations/jira/jira.errors.js";
import type { JiraService } from "../../integrations/jira/jira.service.js";
import type { EngineeringTool } from "../types.js";
import type { ToolContext } from "../tool-context.js";

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function requireJira(context: ToolContext): JiraService {
  if (!context.jira) {
    throw new JiraError("Jira service is unavailable in this runtime.", {
      code: "JIRA_CONFIGURATION_ERROR",
    });
  }
  return context.jira;
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

const searchInputSchema = z.object({
  projectId: projectIdSchema,
  jql: z.string().optional(),
  maxResults: z.number().int().min(1).max(100).optional().default(20),
});

const issueInputSchema = z.object({
  projectId: projectIdSchema,
  issueKey: z.string().trim().min(1),
});

const projectInputSchema = z.object({
  projectId: projectIdSchema,
});

const sprintInputSchema = z.object({
  projectId: projectIdSchema,
  sprintId: z.number().int().positive(),
});

export function createJiraTools(): EngineeringTool[] {
  return [
    withReadPermission({
      name: "jira_search_issues",
      description:
        "Search Jira issues for a configured platform project. JQL is optional and always constrained to the project's Jira key.",
      inputSchema: searchInputSchema,
      execute: async (context, input) => {
        const parsed = searchInputSchema.parse(input);
        const jira = requireJira(context);
        const result = await jira.searchIssues(
          parsed.projectId,
          parsed.jql,
          parsed.maxResults,
        );
        return jsonResult(result);
      },
    }),
    withReadPermission({
      name: "jira_get_issue",
      description:
        "Get a Jira issue by key for a configured platform project. Cross-project issue keys are rejected.",
      inputSchema: issueInputSchema,
      execute: async (context, input) => {
        const parsed = issueInputSchema.parse(input);
        const jira = requireJira(context);
        const result = await jira.getIssue(parsed.projectId, parsed.issueKey);
        return jsonResult(result);
      },
    }),
    withReadPermission({
      name: "jira_get_project",
      description: "Get Jira project metadata for a configured platform projectId.",
      inputSchema: projectInputSchema,
      execute: async (context, input) => {
        const parsed = projectInputSchema.parse(input);
        const jira = requireJira(context);
        const result = await jira.getProject(parsed.projectId);
        return jsonResult(result);
      },
    }),
    withReadPermission({
      name: "jira_get_sprint",
      description:
        "Get a Jira sprint and its issues for a configured platform project. Foreign sprint issues are rejected.",
      inputSchema: sprintInputSchema,
      execute: async (context, input) => {
        const parsed = sprintInputSchema.parse(input);
        const jira = requireJira(context);
        const result = await jira.getSprint(parsed.projectId, parsed.sprintId);
        return jsonResult(result);
      },
    }),
    withReadPermission({
      name: "jira_get_issue_comments",
      description: "List comments for a Jira issue within a configured platform project.",
      inputSchema: issueInputSchema,
      execute: async (context, input) => {
        const parsed = issueInputSchema.parse(input);
        const jira = requireJira(context);
        const result = await jira.getIssueComments(parsed.projectId, parsed.issueKey);
        return jsonResult(result);
      },
    }),
    withReadPermission({
      name: "jira_get_issue_transitions",
      description:
        "List available transitions for a Jira issue (read-only). Does not execute transitions.",
      inputSchema: issueInputSchema,
      execute: async (context, input) => {
        const parsed = issueInputSchema.parse(input);
        const jira = requireJira(context);
        const result = await jira.getIssueTransitions(parsed.projectId, parsed.issueKey);
        return jsonResult(result);
      },
    }),
    withReadPermission({
      name: "jira_get_current_user",
      description: "Get the authenticated Jira user for the configured API credentials.",
      inputSchema: z.object({}),
      execute: async (context) => {
        const jira = requireJira(context);
        const result = await jira.getCurrentUser();
        return jsonResult(result);
      },
    }),
  ];
}

export const JIRA_TOOL_NAMES = [
  "jira_search_issues",
  "jira_get_issue",
  "jira_get_project",
  "jira_get_sprint",
  "jira_get_issue_comments",
  "jira_get_issue_transitions",
  "jira_get_current_user",
] as const;
