import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GovernanceConfigurationError,
  GovernanceService,
  InMemoryAuditService,
  PolicyLoader,
  validatePermissionsPolicy,
} from "../../src/governance/index.js";

const policiesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../policies");

function knownProjects(ids: string[]): (projectId: string) => boolean {
  const set = new Set(ids);
  return (projectId) => set.has(projectId);
}

describe("GovernanceService", () => {
  const audit = new InMemoryAuditService();
  const governance = GovernanceService.loadFromDirectory({
    policiesDir,
    audit,
    isProjectKnown: knownProjects(["kygo", "clubsync"]),
  });

  it.each([
    ["READ_JIRA", "ALLOW"],
    ["READ_GITHUB", "ALLOW"],
    ["READ_CONFLUENCE", "ALLOW"],
    ["CREATE_BRANCH", "ALLOW"],
    ["CREATE_PULL_REQUEST", "ALLOW"],
    ["UPDATE_JIRA", "HUMAN_APPROVAL"],
    ["UPDATE_CONFLUENCE", "HUMAN_APPROVAL"],
    ["MERGE_PULL_REQUEST", "HUMAN_APPROVAL"],
    ["DEPLOY_STAGING", "HUMAN_APPROVAL"],
    ["DEPLOY_PRODUCTION", "HUMAN_APPROVAL"],
    ["DATABASE_MIGRATION", "HUMAN_APPROVAL"],
    ["DELETE_RESOURCE", "DENY"],
    ["EXECUTE_SHELL", "HUMAN_APPROVAL"],
  ] as const)("%s => %s", (action, decision) => {
    const result = governance.evaluate({
      projectId: "kygo",
      action,
      requestId: `test-${action}`,
    });
    expect(result.decision).toBe(decision);
    expect(result.projectId).toBe("kygo");
    expect(result.action).toBe(action);
    expect(result.requiresApproval).toBe(decision === "HUMAN_APPROVAL");
  });

  it("unknown action => DENY (fail closed)", () => {
    const result = governance.evaluate({
      projectId: "kygo",
      action: "LAUNCH_MISSILES",
    });
    expect(result.decision).toBe("DENY");
    expect(result.riskLevel).toBe("CRITICAL");
  });

  it("unknown project => DENY", () => {
    const result = governance.evaluate({
      projectId: "unknown-project",
      action: "READ_JIRA",
    });
    expect(result.decision).toBe("DENY");
    expect(result.reason).toContain("Unknown project");
  });

  it("missing policy file / invalid config => fail closed DENY", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gov-bad-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "permissions.yaml"),
        "actions:\n  READ_JIRA:\n    decision: ALLOW\n",
        "utf8",
      );
      // missing riskLevel + other required files
      const denyAll = GovernanceService.loadFromDirectory({
        policiesDir: tmp,
        isProjectKnown: () => true,
      });
      const result = denyAll.evaluate({ projectId: "kygo", action: "READ_JIRA" });
      expect(result.decision).toBe("DENY");
      expect(result.reason).toMatch(/fail closed|invalid/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("PolicyLoader throws on invalid permissions", () => {
    expect(() =>
      validatePermissionsPolicy({
        actions: {
          READ_JIRA: { decision: "MAYBE", riskLevel: "LOW" },
        },
      }),
    ).toThrow(GovernanceConfigurationError);
  });

  it("missing required policy file throws from PolicyLoader", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gov-missing-"));
    try {
      expect(() => new PolicyLoader({ policiesDir: tmp }).load()).toThrow(
        GovernanceConfigurationError,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("validates approval rules and builds approval metadata", () => {
    const decision = governance.evaluate({
      projectId: "kygo",
      action: "MERGE_PULL_REQUEST",
    });
    const approval = governance.getApprovalService().buildApprovalRequest(decision);
    expect(approval).toMatchObject({
      required: true,
      minimumApprovers: 1,
      action: "MERGE_PULL_REQUEST",
      projectId: "kygo",
    });
    expect(approval?.conditions).toContain("ci_passed");

    const validation = governance
      .getApprovalService()
      .validateApprovalRequirements("MERGE_PULL_REQUEST");
    expect(validation.valid).toBe(true);
  });

  it("records audit events without secrets", () => {
    audit.clear();
    governance.evaluate({
      projectId: "kygo",
      action: "READ_GITHUB",
      requestId: "audit-1",
      actor: "tester",
    });
    const entries = audit.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      requestId: "audit-1",
      projectId: "kygo",
      actor: "tester",
      action: "READ_GITHUB",
      decision: "ALLOW",
    });
    expect(JSON.stringify(entries[0])).not.toMatch(/token|password|authorization/i);
  });

  it("exposes project settings abstraction without applying complex overrides", () => {
    expect(governance.resolveProjectSettings("kygo")).toEqual({ allowWrite: false });
    expect(governance.resolveProjectSettings("future-project")).toEqual({
      allowWrite: false,
    });
  });
});
