import { McpPermissionError } from "../errors/mcp-errors.js";
import type {
  PermissionAction,
  PermissionDecision,
  PermissionServiceOptions,
} from "./permission.types.js";

/**
 * Foundation permission service.
 * Integration-specific Jira/GitHub/Confluence ACLs will be added later.
 */
export class PermissionService {
  private readonly readOnly: boolean;

  constructor(options: PermissionServiceOptions) {
    this.readOnly = options.readOnly;
  }

  checkPermission(action: PermissionAction): PermissionDecision {
    switch (action) {
      case "READ":
        return {
          allowed: true,
          requiresHumanApproval: false,
          reason: "Read operations are allowed",
        };
      case "WRITE":
        if (this.readOnly) {
          return {
            allowed: false,
            requiresHumanApproval: true,
            reason: "Write operations are denied while MCP_READ_ONLY=true",
          };
        }
        return {
          allowed: true,
          requiresHumanApproval: true,
          reason: "Write operations require human approval",
        };
      case "DELETE":
        return {
          allowed: false,
          requiresHumanApproval: true,
          reason: "Delete operations are denied by default",
        };
      case "EXECUTE":
        return {
          allowed: false,
          requiresHumanApproval: true,
          reason: "Execute operations are denied by default",
        };
      default: {
        const _exhaustive: never = action;
        return _exhaustive;
      }
    }
  }

  assertAllowed(action: PermissionAction): void {
    const decision = this.checkPermission(action);
    if (!decision.allowed) {
      throw new McpPermissionError(decision.reason, {
        details: {
          action,
          requiresHumanApproval: decision.requiresHumanApproval,
        },
      });
    }
  }
}
