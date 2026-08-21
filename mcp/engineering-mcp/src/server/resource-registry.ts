import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { McpError, McpResourceNotFoundError } from "../errors/mcp-errors.js";
import type { ToolContext } from "../tools/tool-context.js";

export interface EngineeringResource {
  /** Unique registry identifier (not necessarily the URI). */
  id: string;
  name: string;
  uri: string;
  description?: string;
  mimeType?: string;
  read: (context: ToolContext) => Promise<ReadResourceResult> | ReadResourceResult;
}

/**
 * Modular resource registration.
 * Future URIs: jira://issue/{projectId}/{issueKey}, github://repo/..., etc.
 * No business resources are registered in the foundation.
 */
export class ResourceRegistry {
  private readonly resources = new Map<string, EngineeringResource>();
  private readonly uris = new Set<string>();

  register(resource: EngineeringResource): void {
    if (this.resources.has(resource.id)) {
      throw new McpError(`Duplicate resource registration rejected: "${resource.id}"`, {
        code: "MCP_VALIDATION_ERROR",
        details: { resourceId: resource.id },
      });
    }

    if (this.uris.has(resource.uri)) {
      throw new McpError(`Duplicate resource URI rejected: "${resource.uri}"`, {
        code: "MCP_VALIDATION_ERROR",
        details: { uri: resource.uri },
      });
    }

    this.resources.set(resource.id, resource);
    this.uris.add(resource.uri);
  }

  get(id: string): EngineeringResource {
    const resource = this.resources.get(id);
    if (!resource) {
      throw new McpResourceNotFoundError(id);
    }
    return resource;
  }

  list(): EngineeringResource[] {
    return [...this.resources.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  size(): number {
    return this.resources.size;
  }

  clear(): void {
    this.resources.clear();
    this.uris.clear();
  }
}
