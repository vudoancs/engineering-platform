import type { ActionType } from "../governance/policy.types.js";
import type { ActionExecutionResult, WorkflowContext } from "./workflow.types.js";

export type WorkflowActionKind = "read" | "write";

export interface WorkflowActionDefinition {
  id: string;
  kind: WorkflowActionKind;
  /** Governance ActionType for policy evaluation. */
  governanceAction: ActionType;
  description: string;
}

/**
 * Known workflow actions. Write actions are placeholders until MCP write tools exist.
 */
export const WORKFLOW_ACTIONS: Record<string, WorkflowActionDefinition> = {
  "jira.get_issue": {
    id: "jira.get_issue",
    kind: "read",
    governanceAction: "READ_JIRA",
    description: "Load a Jira issue (read-only)",
  },
  "github.get_pull_request": {
    id: "github.get_pull_request",
    kind: "read",
    governanceAction: "READ_GITHUB",
    description: "Load a pull request (read-only)",
  },
  "github.get_pull_request_checks": {
    id: "github.get_pull_request_checks",
    kind: "read",
    governanceAction: "READ_GITHUB",
    description: "Load PR checks / CI (read-only)",
  },
  "jira.update_issue": {
    id: "jira.update_issue",
    kind: "write",
    governanceAction: "UPDATE_JIRA",
    description: "Update a Jira issue (NOT_IMPLEMENTED)",
  },
  "github.create_branch": {
    id: "github.create_branch",
    kind: "write",
    governanceAction: "CREATE_BRANCH",
    description: "Create a branch (NOT_IMPLEMENTED)",
  },
  "github.create_pull_request": {
    id: "github.create_pull_request",
    kind: "write",
    governanceAction: "CREATE_PULL_REQUEST",
    description: "Create a pull request (NOT_IMPLEMENTED)",
  },
  "github.merge_pull_request": {
    id: "github.merge_pull_request",
    kind: "write",
    governanceAction: "MERGE_PULL_REQUEST",
    description: "Merge a pull request (NOT_IMPLEMENTED)",
  },
};

export const KNOWN_WORKFLOW_ACTION_IDS = Object.keys(WORKFLOW_ACTIONS);

export interface ActionExecutor {
  execute(actionId: string, context: WorkflowContext): Promise<ActionExecutionResult>;
}

/**
 * In-process action executor. Never performs external writes.
 * Read actions return context-derived stubs (no HTTP).
 */
export class StubActionExecutor implements ActionExecutor {
  async execute(actionId: string, context: WorkflowContext): Promise<ActionExecutionResult> {
    const def = WORKFLOW_ACTIONS[actionId];
    if (!def) {
      return { status: "FAILED", error: `Unknown action "${actionId}"` };
    }
    if (def.kind === "write") {
      return {
        status: "NOT_IMPLEMENTED",
        error: `NOT_IMPLEMENTED: Action "${actionId}" is a write placeholder and must not execute external writes`,
      };
    }

    switch (actionId) {
      case "jira.get_issue":
        return {
          status: "SUCCESS",
          output: {
            issueKey: context.issueKey ?? null,
            projectId: context.projectId,
            source: "stub",
          },
        };
      case "github.get_pull_request":
        return {
          status: "SUCCESS",
          output: {
            repository: context.repository ?? null,
            pullRequestNumber: context.pullRequestNumber ?? null,
            projectId: context.projectId,
            source: "stub",
          },
        };
      case "github.get_pull_request_checks":
        return {
          status: "SUCCESS",
          output: {
            repository: context.repository ?? null,
            pullRequestNumber: context.pullRequestNumber ?? null,
            conclusion: context.variables.ciConclusion ?? "unknown",
            source: "stub",
          },
        };
      default:
        return { status: "FAILED", error: `Unhandled read action "${actionId}"` };
    }
  }
}
