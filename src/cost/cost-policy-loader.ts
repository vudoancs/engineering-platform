import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { CostConfigurationError } from "./cost-errors.js";
import type { BudgetLimits, CostLimitsConfig } from "./cost.types.js";

export function loadCostLimitsConfig(policiesDir: string): CostLimitsConfig {
  const filePath = path.join(path.resolve(policiesDir), "cost-limits.yaml");
  if (!fs.existsSync(filePath)) {
    throw new CostConfigurationError(`Missing cost-limits.yaml at ${filePath}`);
  }
  let raw: unknown;
  try {
    raw = parseYaml(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new CostConfigurationError("Failed to parse cost-limits.yaml", {
      cause: String(error),
    });
  }
  return validateCostLimits(raw);
}

function asLimits(value: unknown, label: string): BudgetLimits {
  if (!value || typeof value !== "object") {
    throw new CostConfigurationError(`${label} must be an object`);
  }
  const o = value as Record<string, unknown>;
  const out: BudgetLimits = {};
  if (o.dailyLimitUsd !== undefined) {
    const n = Number(o.dailyLimitUsd);
    if (!Number.isFinite(n) || n < 0) {
      throw new CostConfigurationError(`${label}.dailyLimitUsd invalid`);
    }
    out.dailyLimitUsd = n;
  }
  if (o.weeklyLimitUsd !== undefined) {
    const n = Number(o.weeklyLimitUsd);
    if (!Number.isFinite(n) || n < 0) {
      throw new CostConfigurationError(`${label}.weeklyLimitUsd invalid`);
    }
    out.weeklyLimitUsd = n;
  }
  if (o.monthlyLimitUsd !== undefined) {
    const n = Number(o.monthlyLimitUsd);
    if (!Number.isFinite(n) || n < 0) {
      throw new CostConfigurationError(`${label}.monthlyLimitUsd invalid`);
    }
    out.monthlyLimitUsd = n;
  }
  return out;
}

function asMap(value: unknown, label: string): Record<string, BudgetLimits> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object") {
    throw new CostConfigurationError(`${label} must be an object`);
  }
  const out: Record<string, BudgetLimits> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = asLimits(v, `${label}.${k}`);
  }
  return out;
}

export function validateCostLimits(raw: unknown): CostLimitsConfig {
  if (!raw || typeof raw !== "object") {
    throw new CostConfigurationError("cost-limits.yaml must be an object");
  }
  const o = raw as Record<string, unknown>;
  const usageRetentionDays = Number(o.usageRetentionDays ?? 90);
  const warningThresholdPercent = Number(o.warningThresholdPercent ?? 80);
  const blockThresholdPercent = Number(o.blockThresholdPercent ?? 100);

  if (!Number.isFinite(usageRetentionDays) || usageRetentionDays < 1) {
    throw new CostConfigurationError("usageRetentionDays must be >= 1");
  }
  if (
    !Number.isFinite(warningThresholdPercent) ||
    warningThresholdPercent < 0 ||
    warningThresholdPercent > 100
  ) {
    throw new CostConfigurationError("warningThresholdPercent must be 0-100");
  }
  if (
    !Number.isFinite(blockThresholdPercent) ||
    blockThresholdPercent < 0 ||
    blockThresholdPercent > 100
  ) {
    throw new CostConfigurationError("blockThresholdPercent must be 0-100");
  }

  return {
    usageRetentionDays,
    warningThresholdPercent,
    blockThresholdPercent,
    global: asLimits(o.global ?? {}, "global"),
    projects: asMap(o.projects, "projects"),
    agents: asMap(o.agents, "agents"),
    members: asMap(o.members, "members"),
  };
}
