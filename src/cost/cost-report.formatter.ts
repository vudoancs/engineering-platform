import type { BudgetService } from "./budget.service.js";
import type { CostSummary, CostDecisionType } from "./cost.types.js";

export interface CostReportInput {
  title?: string;
  summary: CostSummary;
  daily?: { usageUsd: number; limitUsd: number | null };
  monthly?: { usageUsd: number; limitUsd: number | null };
  status?: CostDecisionType;
}

/**
 * Formats human-readable AI cost reports (Slack / CLI).
 */
export class CostReportFormatter {
  format(input: CostReportInput): string {
    const date = new Date(input.summary.period.to);
    const title =
      input.title ??
      `AI COST — ${date.toLocaleString("en-US", { month: "short", day: "numeric" }).toUpperCase()}`;

    const lines: string[] = [
      title,
      "",
      "Total:",
      `$${input.summary.totalCostUsd.toFixed(2)}`,
      "",
      "By Project:",
      ...formatMap(input.summary.byProject),
      "",
      "By Agent:",
      ...formatMap(input.summary.byAgent),
      "",
      "By Provider:",
      ...formatMap(input.summary.byProvider),
    ];

    if (input.daily || input.monthly) {
      lines.push("", "Budget:");
      if (input.daily) {
        lines.push(...formatBudgetLine("Daily", input.daily));
      }
      if (input.monthly) {
        lines.push(...formatBudgetLine("Monthly", input.monthly));
      }
    }

    if (input.status) {
      lines.push("", "Status:", statusEmoji(input.status));
    }

    return lines.join("\n");
  }

  formatWithBudgets(
    summary: CostSummary,
    budgets: BudgetService,
    status?: CostDecisionType,
  ): string {
    const dailyGlobal = budgets.snapshot("GLOBAL", "global", "day");
    const monthlyGlobal = budgets.snapshot("GLOBAL", "global", "month");
    return this.format({
      summary,
      daily: {
        usageUsd: dailyGlobal.usageUsd,
        limitUsd: dailyGlobal.limitUsd,
      },
      monthly: {
        usageUsd: monthlyGlobal.usageUsd,
        limitUsd: monthlyGlobal.limitUsd,
      },
      ...(status !== undefined ? { status } : {}),
    });
  }
}

function formatMap(map: Record<string, number>): string[] {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return ["(none)"];
  const maxKey = Math.max(...entries.map(([k]) => k.length), 8);
  return entries.map(
    ([k, v]) => `${k.padEnd(maxKey)}  $${v.toFixed(2)}`,
  );
}

function formatBudgetLine(
  label: string,
  b: { usageUsd: number; limitUsd: number | null },
): string[] {
  if (b.limitUsd === null) {
    return [`${label}:`, `$${b.usageUsd.toFixed(2)} / (no limit)`];
  }
  const pct = b.limitUsd <= 0 ? 100 : Math.round((b.usageUsd / b.limitUsd) * 100);
  return [
    `${label}:`,
    `$${b.usageUsd.toFixed(2)} / $${b.limitUsd.toFixed(2)}`,
    `${pct}%`,
  ];
}

function statusEmoji(status: CostDecisionType): string {
  if (status === "BLOCK") return "🔴 BLOCK";
  if (status === "WARNING") return "🟡 WARNING";
  return "🟢 ALLOW";
}
