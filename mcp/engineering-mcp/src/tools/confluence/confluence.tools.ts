import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ConfluenceError } from "../../integrations/confluence/confluence.errors.js";
import type { ConfluenceService } from "../../integrations/confluence/confluence.service.js";
import type { EngineeringTool } from "../types.js";
import type { ToolContext } from "../tool-context.js";

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function requireConfluence(context: ToolContext): ConfluenceService {
  if (!context.confluence) {
    throw new ConfluenceError("Confluence service is unavailable in this runtime.", {
      code: "CONFLUENCE_CONFIGURATION_ERROR",
    });
  }
  return context.confluence;
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

const getSpaceSchema = z.object({
  projectId: projectIdSchema,
});

const searchPagesSchema = z.object({
  projectId: projectIdSchema,
  query: z.string().optional(),
  title: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

const pageIdSchema = z.object({
  projectId: projectIdSchema,
  pageId: z.string().trim().min(1),
});

export function createConfluenceTools(): EngineeringTool[] {
  return [
    withReadPermission({
      name: "confluence_get_space",
      description:
        "Get the Confluence space configured for a platform project. Space is resolved from project YAML via projectId.",
      inputSchema: getSpaceSchema,
      execute: async (context, input) => {
        const parsed = getSpaceSchema.parse(input);
        const confluence = requireConfluence(context);
        return jsonResult(await confluence.getSpace(parsed.projectId));
      },
    }),
    withReadPermission({
      name: "confluence_search_pages",
      description:
        "Search Confluence pages within the project's configured space only. Do not pass spaceKey — isolation is enforced server-side.",
      inputSchema: searchPagesSchema,
      execute: async (context, input) => {
        const parsed = searchPagesSchema.parse(input);
        const confluence = requireConfluence(context);
        return jsonResult(
          await confluence.searchPages(parsed.projectId, {
            ...(parsed.query !== undefined ? { query: parsed.query } : {}),
            ...(parsed.title !== undefined ? { title: parsed.title } : {}),
            limit: parsed.limit,
          }),
        );
      },
    }),
    withReadPermission({
      name: "confluence_get_page",
      description:
        "Get a Confluence page by id for a platform project. Rejects pages outside the configured space. Returns readable body text (may be truncated).",
      inputSchema: pageIdSchema,
      execute: async (context, input) => {
        const parsed = pageIdSchema.parse(input);
        const confluence = requireConfluence(context);
        return jsonResult(await confluence.getPage(parsed.projectId, parsed.pageId));
      },
    }),
    withReadPermission({
      name: "confluence_get_page_children",
      description:
        "List direct child pages of a Confluence page within the project's space. Does not return page bodies.",
      inputSchema: pageIdSchema,
      execute: async (context, input) => {
        const parsed = pageIdSchema.parse(input);
        const confluence = requireConfluence(context);
        return jsonResult(await confluence.getPageChildren(parsed.projectId, parsed.pageId));
      },
    }),
    withReadPermission({
      name: "confluence_get_page_ancestors",
      description:
        "List ancestor pages (hierarchy path) for a Confluence page within the project's space.",
      inputSchema: pageIdSchema,
      execute: async (context, input) => {
        const parsed = pageIdSchema.parse(input);
        const confluence = requireConfluence(context);
        return jsonResult(await confluence.getPageAncestors(parsed.projectId, parsed.pageId));
      },
    }),
    withReadPermission({
      name: "confluence_get_page_labels",
      description: "List labels on a Confluence page within the project's configured space.",
      inputSchema: pageIdSchema,
      execute: async (context, input) => {
        const parsed = pageIdSchema.parse(input);
        const confluence = requireConfluence(context);
        return jsonResult(await confluence.getPageLabels(parsed.projectId, parsed.pageId));
      },
    }),
  ];
}

export const CONFLUENCE_TOOL_NAMES = [
  "confluence_get_space",
  "confluence_search_pages",
  "confluence_get_page",
  "confluence_get_page_children",
  "confluence_get_page_ancestors",
  "confluence_get_page_labels",
] as const;
