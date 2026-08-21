import type { CostGovernance } from "./cost-governance.js";
import type { CostViewer, PeriodPreset } from "./cost.types.js";

export type SlackCostCommand =
  | { type: "global_cost"; period: PeriodPreset }
  | { type: "project_cost"; projectId: string; period: PeriodPreset }
  | { type: "project_budget"; projectId: string }
  | { type: "own_cost"; period: PeriodPreset }
  | { type: "unknown"; raw: string };

/**
 * Parse Slack-style cost commands. Never executes AI.
 *
 * Examples:
 * /engineering cost
 * /engineering cost month
 * /engineering kygo cost
 * /engineering kygo budget
 */
export function parseSlackCostCommand(text: string): SlackCostCommand {
  const normalized = text
    .trim()
    .replace(/^\/engineering\s+/i, "")
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (!normalized || normalized === "cost") {
    return { type: "own_cost", period: "day" };
  }
  if (normalized === "cost month" || normalized === "cost week" || normalized === "cost day") {
    const period = normalized.split(" ")[1] as PeriodPreset;
    return { type: "global_cost", period };
  }

  const projectBudget = normalized.match(/^([a-z][a-z0-9-]*)\s+budget$/);
  if (projectBudget) {
    return { type: "project_budget", projectId: projectBudget[1]! };
  }

  const projectCost = normalized.match(
    /^([a-z][a-z0-9-]*)\s+cost(?:\s+(day|week|month))?$/,
  );
  if (projectCost) {
    return {
      type: "project_cost",
      projectId: projectCost[1]!,
      period: (projectCost[2] as PeriodPreset | undefined) ?? "day",
    };
  }

  return { type: "unknown", raw: text };
}

export function handleSlackCostCommand(
  cost: CostGovernance,
  viewer: CostViewer,
  text: string,
): string {
  const cmd = parseSlackCostCommand(text);

  switch (cmd.type) {
    case "own_cost": {
      if (viewer.role === "engineering-manager" || viewer.role === "system") {
        const { text: report } = cost.getReport(viewer, { period: cmd.period });
        return report;
      }
      if (!viewer.memberId) {
        return "memberId is required for personal cost reports.";
      }
      const { text: report } = cost.getReport(viewer, {
        period: cmd.period,
        memberId: viewer.memberId,
      });
      return report;
    }
    case "global_cost": {
      const { text: report } = cost.getReport(
        { role: "engineering-manager" },
        { period: cmd.period },
      );
      // Enforce real viewer auth
      cost.authorization.assertCanViewGlobal(viewer);
      return report;
    }
    case "project_cost": {
      const { text: report } = cost.getReport(viewer, {
        period: cmd.period,
        projectId: cmd.projectId,
      });
      return report;
    }
    case "project_budget": {
      cost.authorization.assertCanViewProject(viewer, cmd.projectId);
      const daily = cost.budgetService.snapshot("PROJECT", cmd.projectId, "day");
      const monthly = cost.budgetService.snapshot(
        "PROJECT",
        cmd.projectId,
        "month",
      );
      return [
        `BUDGET — ${cmd.projectId.toUpperCase()}`,
        "",
        `Daily: $${daily.usageUsd.toFixed(2)} / ${daily.limitUsd !== null ? `$${daily.limitUsd.toFixed(2)}` : "(no limit)"}`,
        `Monthly: $${monthly.usageUsd.toFixed(2)} / ${monthly.limitUsd !== null ? `$${monthly.limitUsd.toFixed(2)}` : "(no limit)"}`,
      ].join("\n");
    }
    default:
      return "Unknown cost command. Try: /engineering cost | /engineering kygo cost | /engineering cost month";
  }
}
