import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { InMemoryAuditService } from "../../src/governance/index.js";
import {
  BudgetBlockedError,
  CostGovernance,
  CostService,
  MissingProjectError,
  ProviderPricingService,
  UnauthorizedCostViewError,
  handleSlackCostCommand,
  parseSlackCostCommand,
  usdToMicros,
  microsToUsd,
  tokenCostMicros,
} from "../../src/cost/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const policiesDir = path.join(repoRoot, "policies");

describe("AI Cost Governance", () => {
  it("calculates input/output/total cost from pricing", () => {
    const pricing = ProviderPricingService.loadFromDirectory(policiesDir);
    const cost = new CostService(pricing);
    // gpt-4o: 2.5 / 10.0 per 1M
    const result = cost.calculate({
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(result.inputCostUsd).toBe(2.5);
    expect(result.outputCostUsd).toBe(10);
    expect(result.totalCostUsd).toBe(12.5);
  });

  it("uses micro-USD integer arithmetic helpers", () => {
    expect(tokenCostMicros(1000, 3)).toBe(3000);
    expect(microsToUsd(usdToMicros(1.23))).toBe(1.23);
  });

  it("aggregates usage by project/agent/provider and is idempotent", () => {
    const audit = new InMemoryAuditService();
    const gov = CostGovernance.loadFromDirectory(policiesDir, audit);

    gov.recordUsage({
      requestId: "r1",
      projectId: "kygo",
      agentId: "developer",
      memberId: "m1",
      provider: "anthropic",
      model: "claude-sonnet",
      inputTokens: 100_000,
      outputTokens: 50_000,
      success: true,
    });
    const dup = gov.recordUsage({
      requestId: "r1",
      projectId: "kygo",
      agentId: "developer",
      memberId: "m1",
      provider: "anthropic",
      model: "claude-sonnet",
      inputTokens: 100_000,
      outputTokens: 50_000,
      success: true,
    });
    expect(dup.duplicate).toBe(true);

    gov.recordUsage({
      requestId: "r2",
      projectId: "clubsync",
      agentId: "reviewer",
      memberId: "m2",
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: 200_000,
      outputTokens: 10_000,
      success: true,
    });

    const summary = gov.getSummary("month");
    expect(summary.byProject.kygo).toBeGreaterThan(0);
    expect(summary.byProject.clubsync).toBeGreaterThan(0);
    expect(summary.byAgent.developer).toBeGreaterThan(0);
    expect(summary.byProvider.anthropic).toBeGreaterThan(0);
    expect(audit.list().some((e) => e.action === "AI_USAGE_RECORDED")).toBe(true);
  });

  it("blocks when projected usage exceeds block threshold", () => {
    const gov = CostGovernance.loadFromDirectory(policiesDir);
    // Burn global daily ($20) with large usage
    for (let i = 0; i < 5; i++) {
      gov.recordUsage({
        requestId: `burn-${i}`,
        projectId: "kygo",
        agentId: "developer",
        memberId: "m1",
        provider: "anthropic",
        model: "claude-opus",
        inputTokens: 500_000,
        outputTokens: 200_000,
        success: true,
      });
    }

    const decision = gov.authorizeExecution({
      requestId: "blocked-req",
      projectId: "kygo",
      agentId: "developer",
      memberId: "m1",
      provider: "anthropic",
      model: "claude-sonnet",
      estimatedCostUsd: 5,
    });
    expect(decision.decision).toBe("BLOCK");
    expect(() =>
      gov.assertCanExecute({
        requestId: "blocked-req-2",
        projectId: "kygo",
        agentId: "developer",
        memberId: "m1",
        provider: "anthropic",
        model: "claude-sonnet",
        estimatedCostUsd: 5,
      }),
    ).toThrow(BudgetBlockedError);
  });

  it("returns WARNING near threshold without blocking", () => {
    const gov = CostGovernance.loadFromDirectory(policiesDir);
    // reviewer daily = $5; push to ~85%
    gov.recordUsage({
      requestId: "warn-1",
      projectId: "kygo",
      agentId: "reviewer",
      memberId: "m9",
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 800_000,
      outputTokens: 200_000,
      success: true,
    });
    // input 800k*2.5/1e6=2, output 200k*10/1e6=2 → $4 → 80% of $5
    const decision = gov.authorizeExecution({
      requestId: "warn-2",
      projectId: "kygo",
      agentId: "reviewer",
      memberId: "m9",
      provider: "openai",
      model: "gpt-4o-mini",
      estimatedCostUsd: 0.3,
    });
    expect(["WARNING", "ALLOW", "BLOCK"]).toContain(decision.decision);
    // projected ~4.3 / 5 = 86% → WARNING
    expect(decision.decision).toBe("WARNING");
  });

  it("requires projectId unless global system op", () => {
    const gov = CostGovernance.loadFromDirectory(policiesDir);
    expect(() =>
      gov.authorizeExecution({
        requestId: "no-project",
        provider: "openai",
        model: "gpt-4o",
        estimatedCostUsd: 0.01,
      }),
    ).toThrow(MissingProjectError);
  });

  it("enforces cost report authorization", () => {
    const gov = CostGovernance.loadFromDirectory(policiesDir);
    gov.recordUsage({
      requestId: "auth-1",
      projectId: "kygo",
      memberId: "alice",
      agentId: "developer",
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: 1000,
      outputTokens: 100,
      success: true,
    });

    expect(() =>
      gov.getReport(
        { role: "developer", memberId: "bob" },
        { memberId: "alice" },
      ),
    ).toThrow(UnauthorizedCostViewError);

    const own = gov.getReport(
      { role: "developer", memberId: "alice" },
      { memberId: "alice" },
    );
    expect(own.summary.byMember.alice).toBeGreaterThan(0);

    const mgr = gov.getReport({ role: "engineering-manager" }, { period: "month" });
    expect(mgr.text).toMatch(/AI COST/i);
  });

  it("parses Slack cost commands", () => {
    expect(parseSlackCostCommand("/engineering cost")).toEqual({
      type: "own_cost",
      period: "day",
    });
    expect(parseSlackCostCommand("/engineering cost month")).toEqual({
      type: "global_cost",
      period: "month",
    });
    expect(parseSlackCostCommand("/engineering kygo cost")).toEqual({
      type: "project_cost",
      projectId: "kygo",
      period: "day",
    });
    expect(parseSlackCostCommand("/engineering kygo budget")).toEqual({
      type: "project_budget",
      projectId: "kygo",
    });

    const gov = CostGovernance.loadFromDirectory(policiesDir);
    const text = handleSlackCostCommand(
      gov,
      { role: "engineering-manager" },
      "/engineering cost month",
    );
    expect(text).toMatch(/Total:/i);
  });

  it("applies strictest applicable limit across scopes", () => {
    const gov = CostGovernance.loadFromDirectory(policiesDir);
    // Fill project kygo daily ($10) while global still has room
    for (let i = 0; i < 3; i++) {
      gov.recordUsage({
        requestId: `proj-${i}`,
        projectId: "kygo",
        agentId: "developer",
        memberId: "m1",
        provider: "anthropic",
        model: "claude-opus",
        inputTokens: 200_000,
        outputTokens: 100_000,
        success: true,
      });
    }
    // opus: 200k*15/1e6=3, 100k*75/1e6=7.5 → 10.5 per call → already over project daily
    const decision = gov.authorizeExecution({
      requestId: "strict",
      projectId: "kygo",
      agentId: "developer",
      memberId: "m1",
      provider: "anthropic",
      model: "claude-haiku",
      estimatedCostUsd: 0.01,
    });
    expect(decision.decision).toBe("BLOCK");
    expect(decision.bindingScope).toBe("PROJECT");
  });

  it("supports estimated then actual cost recording", () => {
    const gov = CostGovernance.loadFromDirectory(policiesDir);
    const pre = gov.authorizeExecution({
      requestId: "est-1",
      projectId: "clubsync",
      agentId: "developer",
      memberId: "m3",
      provider: "openai",
      model: "gpt-4o-mini",
      estimatedCostUsd: 0,
      estimatedInputTokens: 500,
      estimatedOutputTokens: 200,
    });
    expect(pre.decision).not.toBe("BLOCK");
    expect(pre.estimatedCostUsd).toBeGreaterThan(0);

    const { event } = gov.recordUsage({
      requestId: "est-1-actual",
      projectId: "clubsync",
      agentId: "developer",
      memberId: "m3",
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: 500,
      outputTokens: 200,
      success: true,
    });
    expect(event.actualCostUsd).toBe(true);
  });
});
