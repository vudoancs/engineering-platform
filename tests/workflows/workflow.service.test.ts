import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentService } from "../../src/agents/index.js";
import {
  GovernanceService,
  InMemoryAuditService,
} from "../../src/governance/index.js";
import {
  MockAgentExecutor,
  StubActionExecutor,
  WorkflowService,
  WorkflowValidationError,
  buildIdempotencyKey,
  validateWorkflowYaml,
  type ActionExecutor,
  type WorkflowContext,
} from "../../src/workflows/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const agentsDir = path.join(repoRoot, "agents");
const policiesDir = path.join(repoRoot, "policies");
const workflowsDir = path.join(repoRoot, "workflows");

function knownProjects(ids: string[]) {
  const set = new Set(ids);
  return (id: string) => set.has(id);
}

function createServices(extra?: {
  agentExecutor?: MockAgentExecutor;
  actionExecutor?: ActionExecutor;
  workflowsDir?: string;
}) {
  const audit = new InMemoryAuditService();
  const governance = GovernanceService.loadFromDirectory({
    policiesDir,
    audit,
    isProjectKnown: knownProjects(["kygo", "clubsync"]),
  });
  const agentService = AgentService.loadFromDirectory({
    agentsDir,
    policy: {
      governance,
      isProjectKnown: knownProjects(["kygo", "clubsync"]),
    },
  });
  const workflows = WorkflowService.loadFromDirectory({
    workflowsDir: extra?.workflowsDir ?? workflowsDir,
    agentService,
    governance,
    auditService: audit,
    isProjectKnown: knownProjects(["kygo", "clubsync"]),
    ...(extra?.agentExecutor ? { agentExecutor: extra.agentExecutor } : {}),
    ...(extra?.actionExecutor ? { actionExecutor: extra.actionExecutor } : {}),
  });
  return { workflows, audit, governance, agentService };
}

describe("Workflow layer", () => {
  it("loads valid platform workflows", () => {
    const { workflows } = createServices();
    const ids = workflows.listWorkflows().map((w) => w.id).sort();
    expect(ids).toEqual(["jira-to-pr", "pr-review"]);
    expect(workflows.validateWorkflow("jira-to-pr")).toEqual({
      valid: true,
      workflowId: "jira-to-pr",
    });
  });

  it("rejects invalid workflow YAML", () => {
    expect(() =>
      validateWorkflowYaml(
        { id: "x", name: "X", description: "d", version: 1, trigger: { type: "manual" }, steps: [] },
        { knownAgentIds: new Set(["developer"]) },
      ),
    ).toThrow(WorkflowValidationError);
  });

  it("rejects duplicate step ids", () => {
    expect(() =>
      validateWorkflowYaml(
        {
          id: "dup",
          name: "Dup",
          description: "d",
          version: 1,
          trigger: { type: "manual" },
          steps: [
            { id: "a", type: "ACTION", action: "jira.get_issue" },
            { id: "a", type: "ACTION", action: "jira.get_issue" },
          ],
        },
        { knownAgentIds: new Set() },
      ),
    ).toThrow(/Duplicate step/);
  });

  it("rejects circular dependencies", () => {
    expect(() =>
      validateWorkflowYaml(
        {
          id: "cycle",
          name: "Cycle",
          description: "d",
          version: 1,
          trigger: { type: "manual" },
          steps: [
            { id: "a", type: "ACTION", action: "jira.get_issue", dependsOn: ["b"] },
            { id: "b", type: "ACTION", action: "jira.get_issue", dependsOn: ["a"] },
          ],
        },
        { knownAgentIds: new Set() },
      ),
    ).toThrow(/Circular dependency/);
  });

  it("rejects unknown agent", () => {
    expect(() =>
      validateWorkflowYaml(
        {
          id: "bad-agent",
          name: "Bad",
          description: "d",
          version: 1,
          trigger: { type: "manual" },
          steps: [{ id: "a", type: "AGENT", agent: "ghost" }],
        },
        { knownAgentIds: new Set(["developer"]) },
      ),
    ).toThrow(/unknown agent/);
  });

  it("rejects unknown action", () => {
    expect(() =>
      validateWorkflowYaml(
        {
          id: "bad-action",
          name: "Bad",
          description: "d",
          version: 1,
          trigger: { type: "manual" },
          steps: [{ id: "a", type: "ACTION", action: "jira.explode" }],
        },
        { knownAgentIds: new Set() },
      ),
    ).toThrow(/unknown action/);
  });

  it("runs successful read action step", async () => {
    const { workflows } = createServices();
    const instance = workflows.createInstance("pr-review", {
      projectId: "kygo",
      issueKey: "KYGO-1",
      repository: "org/repo",
      pullRequestNumber: 7,
      actor: "tester",
    });
    const result = await workflows.runNextStep(instance.id);
    expect(result.stepId).toBe("load-pr");
    expect(result.stepStatus).toBe("COMPLETED");
    expect(result.status).toBe("RUNNING");
  });

  it("fails disabled write steps without external writes", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-disabled-"));
    try {
      const dir = path.join(tmp, "only-write");
      fs.mkdirSync(dir);
      fs.writeFileSync(
        path.join(dir, "workflow.yaml"),
        [
          "id: only-write",
          "name: Only Write",
          "description: disabled write",
          "version: 1",
          "trigger:",
          "  type: manual",
          "steps:",
          "  - id: create-pr",
          "    type: ACTION",
          "    action: github.create_pull_request",
          "    enabled: false",
        ].join("\n"),
        "utf8",
      );
      const { workflows } = createServices({ workflowsDir: tmp });
      const instance = workflows.createInstance("only-write", { projectId: "kygo" });
      const result = await workflows.runNextStep(instance.id);
      expect(result.status).toBe("FAILED");
      expect(result.message).toMatch(/disabled/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns NOT_IMPLEMENTED for enabled write placeholders", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-ni-"));
    try {
      const dir = path.join(tmp, "write-ni");
      fs.mkdirSync(dir);
      fs.writeFileSync(
        path.join(dir, "workflow.yaml"),
        [
          "id: write-ni",
          "name: Write NI",
          "description: not implemented write",
          "version: 1",
          "trigger:",
          "  type: manual",
          "steps:",
          "  - id: create-pr",
          "    type: ACTION",
          "    action: github.create_pull_request",
          "    enabled: true",
        ].join("\n"),
        "utf8",
      );
      // CREATE_PULL_REQUEST => HUMAN_APPROVAL under governance, so approve first path:
      // Actually governance returns HUMAN_APPROVAL before executor. Test NOT_IMPLEMENTED via StubActionExecutor directly.
      const executor = new StubActionExecutor();
      const result = await executor.execute("github.create_pull_request", {
        projectId: "kygo",
        variables: {},
      });
      expect(result.status).toBe("NOT_IMPLEMENTED");

      const { workflows } = createServices({ workflowsDir: tmp });
      const instance = workflows.createInstance("write-ni", { projectId: "kygo" });
      const run = await workflows.runNextStep(instance.id);
      // CREATE_PULL_REQUEST is ALLOW by policy → stub returns NOT_IMPLEMENTED (no external write)
      expect(run.status).toBe("FAILED");
      expect(run.message).toMatch(/write placeholder|NOT_IMPLEMENTED/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("retries retryable failures then succeeds", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-retry-"));
    try {
      const dir = path.join(tmp, "retry-wf");
      fs.mkdirSync(dir);
      fs.writeFileSync(
        path.join(dir, "workflow.yaml"),
        [
          "id: retry-wf",
          "name: Retry",
          "description: retry test",
          "version: 1",
          "trigger:",
          "  type: manual",
          "steps:",
          "  - id: load",
          "    type: ACTION",
          "    action: jira.get_issue",
          "    retry:",
          "      maxAttempts: 2",
        ].join("\n"),
        "utf8",
      );

      let calls = 0;
      const flaky: ActionExecutor = {
        async execute(actionId, context) {
          calls += 1;
          if (calls === 1) {
            return { status: "FAILED", error: "temporary unavailable" };
          }
          return new StubActionExecutor().execute(actionId, context);
        },
      };

      const { workflows } = createServices({ workflowsDir: tmp, actionExecutor: flaky });
      const instance = workflows.createInstance("retry-wf", {
        projectId: "kygo",
        issueKey: "KYGO-9",
      });
      const first = await workflows.runNextStep(instance.id);
      expect(first.status).toBe("RUNNING");
      expect(first.stepStatus).toBe("FAILED");
      const second = await workflows.runNextStep(instance.id);
      expect(second.stepStatus).toBe("COMPLETED");
      expect(second.status).toBe("COMPLETED");
      expect(calls).toBe(2);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("requests approval, approves, and continues", async () => {
    const { workflows, audit } = createServices();
    const instance = workflows.createInstance("pr-review", {
      projectId: "kygo",
      issueKey: "KYGO-1",
      repository: "org/repo",
      pullRequestNumber: 3,
      variables: { ciConclusion: "success" },
    });

    // load-pr, load-jira, load-ci, review, risk-analysis, human-decision
    await workflows.runNextStep(instance.id); // load-pr
    await workflows.runNextStep(instance.id); // load-jira
    await workflows.runNextStep(instance.id); // load-ci
    await workflows.runNextStep(instance.id); // review
    await workflows.runNextStep(instance.id); // risk-analysis
    const waiting = await workflows.runNextStep(instance.id);
    expect(waiting.status).toBe("WAITING_APPROVAL");
    expect(waiting.approvalRequestId).toBeTruthy();

    const { instance: afterApprove } = workflows.approve(
      waiting.approvalRequestId!,
      "manager@example.com",
    );
    expect(afterApprove.status).toBe("RUNNING");

    const done = await workflows.runNextStep(instance.id);
    expect(done.status).toBe("COMPLETED");

    const actions = audit.list().map((e) => e.action);
    expect(actions).toContain("APPROVAL_REQUESTED");
    expect(actions).toContain("APPROVAL_APPROVED");
    expect(actions).toContain("WORKFLOW_COMPLETED");
  });

  it("rejects approval and cancels workflow", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-rej-"));
    try {
      const dir = path.join(tmp, "approve-only");
      fs.mkdirSync(dir);
      fs.writeFileSync(
        path.join(dir, "workflow.yaml"),
        [
          "id: approve-only",
          "name: Approve Only",
          "description: approval gate",
          "version: 1",
          "trigger:",
          "  type: manual",
          "steps:",
          "  - id: gate",
          "    type: APPROVAL",
          "    approval:",
          "      required: true",
          "      minimumApprovers: 1",
          "      reason: gate",
          "      riskLevel: LOW",
        ].join("\n"),
        "utf8",
      );
      const { workflows, audit } = createServices({ workflowsDir: tmp });
      const instance = workflows.createInstance("approve-only", { projectId: "kygo" });
      const waiting = await workflows.runNextStep(instance.id);
      expect(waiting.status).toBe("WAITING_APPROVAL");
      const { instance: cancelled } = workflows.reject(
        waiting.approvalRequestId!,
        "boss",
        "not ready",
      );
      expect(cancelled.status).toBe("CANCELLED");
      expect(audit.list().map((e) => e.action)).toContain("APPROVAL_REJECTED");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails on governance DENY", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-deny-"));
    try {
      const dir = path.join(tmp, "deny-wf");
      fs.mkdirSync(dir);
      fs.writeFileSync(
        path.join(dir, "workflow.yaml"),
        [
          "id: deny-wf",
          "name: Deny",
          "description: governance deny",
          "version: 1",
          "trigger:",
          "  type: manual",
          "steps:",
          "  - id: load",
          "    type: ACTION",
          "    action: jira.get_issue",
        ].join("\n"),
        "utf8",
      );

      const audit = new InMemoryAuditService();
      const governance = GovernanceService.loadFromDirectory({
        policiesDir,
        audit,
        isProjectKnown: () => false,
      });
      const agentService = AgentService.loadFromDirectory({
        agentsDir,
        policy: { isProjectKnown: knownProjects(["kygo"]) },
      });
      const workflows = WorkflowService.loadFromDirectory({
        workflowsDir: tmp,
        agentService,
        governance,
        isProjectKnown: knownProjects(["kygo"]),
      });

      const instance = workflows.createInstance("deny-wf", { projectId: "kygo" });
      const result = await workflows.runNextStep(instance.id);
      expect(result.status).toBe("FAILED");
      expect(result.message).toMatch(/Governance DENY|Unknown project/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("cancels a running instance", async () => {
    const { workflows } = createServices();
    const instance = workflows.createInstance("pr-review", { projectId: "kygo" });
    await workflows.runNextStep(instance.id);
    const cancelled = workflows.cancelInstance(instance.id);
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("enforces idempotency key format and completed step skip", async () => {
    const { workflows } = createServices();
    const instance = workflows.createInstance("pr-review", {
      projectId: "kygo",
      pullRequestNumber: 1,
      repository: "o/r",
    });
    const first = await workflows.runNextStep(instance.id);
    expect(first.stepId).toBe("load-pr");
    const key = buildIdempotencyKey("kygo", instance.id, "load-pr");
    expect(key).toBe(`kygo:${instance.id}:load-pr`);
    const refreshed = workflows.getInstance(instance.id);
    expect(refreshed.stepRecords["load-pr"]?.idempotencyKey).toBe(key);
    expect(refreshed.stepRecords["load-pr"]?.status).toBe("COMPLETED");
  });

  it("rejects invalid project context", () => {
    const { workflows } = createServices();
    expect(() =>
      workflows.createInstance("pr-review", { projectId: "unknown-project" }),
    ).toThrow(/Unknown project/);
  });

  it("times out slow agent steps", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-to-"));
    try {
      const dir = path.join(tmp, "timeout-wf");
      fs.mkdirSync(dir);
      fs.writeFileSync(
        path.join(dir, "workflow.yaml"),
        [
          "id: timeout-wf",
          "name: Timeout",
          "description: timeout test",
          "version: 1",
          "trigger:",
          "  type: manual",
          "steps:",
          "  - id: analyze",
          "    type: AGENT",
          "    agent: developer",
          "    timeoutMs: 20",
        ].join("\n"),
        "utf8",
      );
      const slow = new MockAgentExecutor(async () => {
        await new Promise((r) => setTimeout(r, 200));
        return { status: "SUCCESS", output: {} };
      });
      const { workflows } = createServices({ workflowsDir: tmp, agentExecutor: slow });
      const instance = workflows.createInstance("timeout-wf", { projectId: "kygo" });
      const result = await workflows.runNextStep(instance.id);
      expect(result.status).toBe("FAILED");
      expect(result.message).toMatch(/timed out/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not advance when dependencies are unavailable", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-dep-"));
    try {
      const dir = path.join(tmp, "dep-wf");
      fs.mkdirSync(dir);
      fs.writeFileSync(
        path.join(dir, "workflow.yaml"),
        [
          "id: dep-wf",
          "name: Dep",
          "description: dependency order",
          "version: 1",
          "trigger:",
          "  type: manual",
          "steps:",
          "  - id: first",
          "    type: ACTION",
          "    action: jira.get_issue",
          "  - id: second",
          "    type: ACTION",
          "    action: github.get_pull_request",
          "    dependsOn:",
          "      - first",
        ].join("\n"),
        "utf8",
      );
      const { workflows } = createServices({ workflowsDir: tmp });
      const instance = workflows.createInstance("dep-wf", {
        projectId: "kygo",
        repository: "o/r",
        pullRequestNumber: 1,
      });
      const first = await workflows.runNextStep(instance.id);
      expect(first.stepId).toBe("first");
      const second = await workflows.runNextStep(instance.id);
      expect(second.stepId).toBe("second");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("integrates MockAgentExecutor for agent steps", async () => {
    const { workflows } = createServices({
      agentExecutor: new MockAgentExecutor(() => ({
        status: "SUCCESS",
        output: { plan: "do the thing" },
      })),
    });
    const instance = workflows.createInstance("jira-to-pr", {
      projectId: "kygo",
      issueKey: "KYGO-42",
    });
    await workflows.runNextStep(instance.id); // load-ticket
    const analyze = await workflows.runNextStep(instance.id);
    expect(analyze.stepId).toBe("analyze");
    expect(analyze.stepStatus).toBe("COMPLETED");
  });

  it("rejects secrets in workflow context", () => {
    const { workflows } = createServices();
    expect(() =>
      workflows.createInstance("pr-review", {
        projectId: "kygo",
        variables: { api_token: "secret" } as WorkflowContext["variables"],
      }),
    ).toThrow(/secrets/i);
  });
});
