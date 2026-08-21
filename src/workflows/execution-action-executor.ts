import type { ActionExecutor } from "./action-executor.js";
import { WORKFLOW_ACTIONS, StubActionExecutor } from "./action-executor.js";
import type { ActionExecutionResult, WorkflowContext } from "./workflow.types.js";
import type { ExecutionService } from "../execution/execution.service.js";
import type { ExecutionActionId } from "../execution/execution.types.js";
import { randomUUID } from "node:crypto";

/**
 * Routes workflow ACTION steps through ExecutionService for controlled writes.
 * Read actions stay on StubActionExecutor (no HTTP from workflow layer).
 */
export class ExecutionBackedActionExecutor implements ActionExecutor {
  private readonly reads = new StubActionExecutor();

  constructor(private readonly execution: ExecutionService) {}

  async execute(
    actionId: string,
    context: WorkflowContext,
  ): Promise<ActionExecutionResult> {
    const def = WORKFLOW_ACTIONS[actionId];
    if (!def) {
      return { status: "FAILED", error: `Unknown action "${actionId}"` };
    }
    if (def.kind === "read") {
      return this.reads.execute(actionId, context);
    }

    try {
      const result = await this.execution.execute({
        requestId: randomUUID(),
        projectId: context.projectId,
        actor: {
          type: "workflow",
          id: context.actor ?? "workflow",
        },
        action: actionId as ExecutionActionId,
        resource: {
          ...(context.repository ? { repository: context.repository } : {}),
          ...(context.issueKey ? { issueKey: context.issueKey } : {}),
          ...(context.branch ? { branchName: context.branch } : {}),
          ...(context.pullRequestNumber !== undefined
            ? { pullRequestNumber: context.pullRequestNumber }
            : {}),
        },
        parameters: {
          ...(context.variables ?? {}),
          ...(context.issueKey ? { issueKey: context.issueKey } : {}),
        },
        reason: `Workflow action ${actionId}`,
        ...(typeof context.variables.approvalRequestId === "string"
          ? { approvalRequestId: context.variables.approvalRequestId }
          : {}),
        ...(context.variables.dryRun === true ? { dryRun: true } : {}),
      });

      if (!result.success) {
        return { status: "FAILED", error: result.error ?? "Execution failed" };
      }
      return { status: "SUCCESS", output: result.result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Execution failed";
      if (/approval required/i.test(message)) {
        return { status: "WAITING_APPROVAL", error: message };
      }
      if (/disabled by engineering policy/i.test(message)) {
        return {
          status: "FAILED",
          error: `BLOCKED_BY_DISABLED_ACTION: ${message}`,
        };
      }
      if (/NOT_IMPLEMENTED/i.test(message)) {
        return { status: "NOT_IMPLEMENTED", error: message };
      }
      return { status: "FAILED", error: message };
    }
  }
}
