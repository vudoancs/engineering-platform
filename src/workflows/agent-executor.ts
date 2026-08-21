import type {
  AgentExecutionInput,
  AgentExecutionResult,
} from "./workflow.types.js";

/**
 * External AI runtime boundary. Platform does not embed an LLM SDK.
 */
export interface AgentExecutor {
  execute(input: AgentExecutionInput): Promise<AgentExecutionResult>;
}

/**
 * Deterministic mock for tests and local dry-runs.
 */
export class MockAgentExecutor implements AgentExecutor {
  constructor(
    private readonly handler?: (
      input: AgentExecutionInput,
    ) => Promise<AgentExecutionResult> | AgentExecutionResult,
  ) {}

  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    if (this.handler) {
      return this.handler(input);
    }

    if (input.agentId === "reviewer") {
      return {
        status: "SUCCESS",
        output: {
          summary: "Mock PR review",
          correctnessIssues: [],
          securityIssues: [],
          performanceIssues: [],
          testingGaps: [],
          riskLevel: "MEDIUM",
          recommendation: "Request human decision — do not merge automatically",
        },
        evidence: { agentId: input.agentId, stepId: input.stepId },
      };
    }

    return {
      status: "SUCCESS",
      output: {
        agentId: input.agentId,
        stepId: input.stepId,
        message: "Mock agent execution completed",
      },
      evidence: { projectId: input.projectId },
    };
  }
}
