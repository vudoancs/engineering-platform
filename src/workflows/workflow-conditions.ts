import type { PredefinedCondition, WorkflowContext } from "./workflow.types.js";

export interface ConditionEvaluation {
  passed: boolean;
  condition: PredefinedCondition;
  reason: string;
}

/**
 * Minimal deterministic conditions — no scripting language.
 */
export function evaluateCondition(
  condition: PredefinedCondition,
  context: WorkflowContext,
): ConditionEvaluation {
  switch (condition) {
    case "CI_PASSED": {
      const conclusion = String(context.variables.ciConclusion ?? "").toLowerCase();
      const passed = conclusion === "success" || conclusion === "passed";
      return {
        condition,
        passed,
        reason: passed
          ? "CI conclusion indicates success"
          : `CI not passed (ciConclusion=${context.variables.ciConclusion ?? "missing"})`,
      };
    }
    case "PR_APPROVED": {
      const approved = context.variables.prApproved === true;
      return {
        condition,
        passed: approved,
        reason: approved ? "PR marked approved in context" : "PR not approved in context",
      };
    }
    case "RISK_LTE_MEDIUM": {
      const risk = String(context.variables.riskLevel ?? "HIGH").toUpperCase();
      const order = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
      const idx = order.indexOf(risk);
      const passed = idx >= 0 && idx <= order.indexOf("MEDIUM");
      return {
        condition,
        passed,
        reason: passed
          ? `Risk ${risk} is <= MEDIUM`
          : `Risk ${risk} exceeds MEDIUM`,
      };
    }
    default: {
      const _exhaustive: never = condition;
      return {
        condition: _exhaustive,
        passed: false,
        reason: "Unknown condition",
      };
    }
  }
}
