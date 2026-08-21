import { describe, expect, it } from "vitest";
import {
  classifyIssueBucket,
  countWorkBuckets,
  extractIssueKeys,
  extractIssueKeysFromPr,
  evaluatePrRiskLevel,
  isExplicitlyBlocked,
  progressPercentages,
} from "../src/services/engineering/engineering.mapper.js";
import { RiskService } from "../src/services/engineering/risk/risk.service.js";
import { DEFAULT_ENGINEERING_THRESHOLDS } from "../src/services/engineering/engineering.types.js";

describe("engineering.mapper", () => {
  it("classifies blocked via status/label/summary only", () => {
    expect(
      isExplicitlyBlocked({ status: "Blocked", labels: [], summary: "X" }),
    ).toBe(true);
    expect(
      isExplicitlyBlocked({ status: "In Progress", labels: ["blocked"], summary: "X" }),
    ).toBe(true);
    expect(
      isExplicitlyBlocked({ status: "In Progress", labels: [], summary: "Work is blocked" }),
    ).toBe(true);
    expect(
      isExplicitlyBlocked({ status: "In Progress", labels: [], summary: "Old ticket" }),
    ).toBe(false);
  });

  it("counts work buckets", () => {
    const counts = countWorkBuckets([
      { status: "To Do", statusCategory: "To Do", labels: [], summary: "a" },
      { status: "In Progress", statusCategory: "In Progress", labels: [], summary: "b" },
      { status: "Done", statusCategory: "Done", labels: [], summary: "c" },
      { status: "Blocked", labels: [], summary: "d" },
    ]);
    expect(counts).toEqual({ total: 4, todo: 1, inProgress: 1, done: 1, blocked: 1 });
  });

  it("handles zero tickets progress safely", () => {
    expect(progressPercentages(0, 0)).toEqual({
      completedPercentage: 0,
      remainingPercentage: 0,
    });
  });

  it("extracts project-scoped issue keys for correlation", () => {
    expect(extractIssueKeys("Fix KYGO-123 and CLUBSYNC-9", "KYGO")).toEqual(["KYGO-123"]);
    expect(extractIssueKeys("no keys here", "KYGO")).toEqual([]);
  });

  it("extracts keys from PR title/branch/body", () => {
    const keys = extractIssueKeysFromPr(
      {
        title: "KYGO-42 auth",
        sourceBranch: "feature/KYGO-42-login",
        body: "Related to KYGO-99",
      },
      "KYGO",
    );
    expect(keys).toContain("KYGO-42");
    expect(keys).toContain("KYGO-99");
  });

  it("evaluates PR risk levels deterministically", () => {
    expect(
      evaluatePrRiskLevel({
        ciFailed: true,
        changesRequested: false,
        waitingForReview: false,
        thresholds: DEFAULT_ENGINEERING_THRESHOLDS,
      }),
    ).toBe("high");

    expect(
      evaluatePrRiskLevel({
        ageHours: 50,
        ciFailed: false,
        changesRequested: false,
        waitingForReview: false,
        thresholds: DEFAULT_ENGINEERING_THRESHOLDS,
      }),
    ).toBe("medium");

    expect(
      evaluatePrRiskLevel({
        changeSize: 600,
        ciFailed: false,
        changesRequested: false,
        waitingForReview: false,
        thresholds: DEFAULT_ENGINEERING_THRESHOLDS,
      }),
    ).toBe("medium");

    expect(
      evaluatePrRiskLevel({
        ageHours: 2,
        ciFailed: false,
        changesRequested: false,
        waitingForReview: false,
        thresholds: DEFAULT_ENGINEERING_THRESHOLDS,
      }),
    ).toBe("low");
  });

  it("classifyIssueBucket prefers blocked over in-progress", () => {
    expect(
      classifyIssueBucket({
        status: "Blocked",
        statusCategory: "In Progress",
        labels: [],
        summary: "x",
      }),
    ).toBe("blocked");
  });
});

describe("RiskService", () => {
  const risk = new RiskService(DEFAULT_ENGINEERING_THRESHOLDS);
  const now = new Date("2026-08-21T00:00:00.000Z");

  it("builds blocked and stale risks with evidence", () => {
    const issues = [
      {
        key: "KYGO-1",
        summary: "Blocked auth",
        status: "Blocked",
        issueType: "Task",
        labels: [],
        updatedAt: "2026-08-20T00:00:00.000Z",
      },
      {
        key: "KYGO-2",
        summary: "Stale",
        status: "In Progress",
        statusCategory: "In Progress",
        issueType: "Task",
        labels: [],
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ];

    const blocked = risk.buildBlockedRisks(issues);
    const stale = risk.buildStaleRisks(issues, now, 7);
    expect(blocked[0]?.type).toBe("BLOCKED_TICKET");
    expect(blocked[0]?.evidence[0]?.issueKey).toBe("KYGO-1");
    expect(stale[0]?.type).toBe("STALE_TICKET");
  });

  it("builds PR CI / stale / large risks", () => {
    const risks = risk.buildPrRisks([
      {
        repository: "kygo",
        number: 10,
        title: "big",
        ageHours: 80,
        waitingHours: 80,
        ciFailed: true,
        changesRequested: false,
        waitingForReview: true,
        changeSize: 1200,
      },
    ]);
    const types = risks.map((r) => r.type);
    expect(types).toContain("PR_CI_FAILED");
    expect(types).toContain("PR_HIGH_AGE");
    expect(types).toContain("LARGE_PR");
  });

  it("aggregates overall risk from multiple highs to critical", () => {
    const risks = risk.buildPrRisks([
      {
        repository: "a",
        number: 1,
        title: "1",
        ciFailed: true,
        changesRequested: false,
        waitingForReview: false,
      },
      {
        repository: "a",
        number: 2,
        title: "2",
        ciFailed: true,
        changesRequested: false,
        waitingForReview: false,
      },
      {
        repository: "a",
        number: 3,
        title: "3",
        ciFailed: true,
        changesRequested: false,
        waitingForReview: false,
      },
    ]);
    expect(risk.aggregateOverallRisk(risks)).toBe("critical");
  });
});
