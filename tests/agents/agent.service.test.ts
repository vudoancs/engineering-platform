import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AgentConfigurationError,
  AgentLoader,
  AgentNotFoundError,
  AgentPolicy,
  AgentService,
  AgentToolDeniedError,
  AgentValidationError,
  DEFAULT_KNOWN_MCP_TOOLS,
  validateAgentYaml,
} from "../../src/agents/index.js";
import { GovernanceService } from "../../src/governance/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const agentsDir = path.join(repoRoot, "agents");
const policiesDir = path.join(repoRoot, "policies");

function writeAgent(
  root: string,
  id: string,
  yaml: string,
  instructions = "# Instructions\n\nDo the job.",
): void {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "agent.yaml"), yaml, "utf8");
  fs.writeFileSync(path.join(dir, "instructions.md"), instructions, "utf8");
}

describe("Agent layer", () => {
  it("loads valid platform agents", () => {
    const service = AgentService.loadFromDirectory({
      agentsDir,
      knownTools: DEFAULT_KNOWN_MCP_TOOLS,
      policy: { isProjectKnown: (id) => id === "kygo" || id === "clubsync" },
    });

    const ids = service.listAgents().map((a) => a.id);
    expect(ids).toEqual(["developer", "engineering-manager", "reviewer"]);

    for (const id of ids) {
      expect(service.validateAgent(id)).toEqual({ valid: true, agentId: id });
      expect(service.getInstructions(id).length).toBeGreaterThan(50);
      expect(service.getAllowedTools(id).length).toBeGreaterThan(0);
    }
  });

  it("rejects invalid agent YAML", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agents-bad-yaml-"));
    try {
      writeAgent(
        tmp,
        "broken",
        "id: broken\nname: Broken\n", // missing required fields
      );
      expect(() => new AgentLoader({ agentsDir: tmp }).loadAll()).toThrow(AgentValidationError);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects missing instructions", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agents-no-instr-"));
    try {
      const dir = path.join(tmp, "solo");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "agent.yaml"),
        [
          "id: solo",
          "name: Solo",
          "description: Test agent",
          "role: tester",
          "allowedTools:",
          "  - jira_get_issue",
          "governanceProfile: read-only",
        ].join("\n"),
        "utf8",
      );
      expect(() => new AgentLoader({ agentsDir: tmp }).loadOne("solo")).toThrow(
        AgentConfigurationError,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects unknown tools at validation", () => {
    expect(() =>
      validateAgentYaml(
        {
          id: "ghost",
          name: "Ghost",
          description: "Uses unknown tool",
          role: "tester",
          allowedTools: ["unknown_tool"],
          governanceProfile: "read-only",
        },
        { knownTools: new Set(DEFAULT_KNOWN_MCP_TOOLS) },
      ),
    ).toThrow(/unknown_tool/);
  });

  it("enforces tool allowlist at runtime", () => {
    const service = AgentService.loadFromDirectory({ agentsDir });
    const denied = service.checkToolPermission("developer", "confluence_get_page");
    expect(denied.allowed).toBe(false);

    expect(() => service.assertToolAllowed("developer", "confluence_get_page")).toThrow(
      AgentToolDeniedError,
    );

    const allowed = service.checkToolPermission("developer", "jira_get_issue");
    expect(allowed.allowed).toBe(true);
  });

  it("validates project context", () => {
    const policy = new AgentPolicy({
      isProjectKnown: (id) => id === "kygo",
    });
    expect(() => policy.assertProjectContext("kygo")).not.toThrow();
    expect(() => policy.assertProjectContext("unknown")).toThrow(/Unknown project/);
    expect(() => policy.assertProjectContext("")).toThrow(/projectId is required/);
  });

  it("invalid project context via AgentService", () => {
    const service = AgentService.loadFromDirectory({
      agentsDir,
      policy: { isProjectKnown: (id) => id === "kygo" },
    });
    expect(() => service.assertProjectContext("kygo")).not.toThrow();
    expect(() => service.assertProjectContext("nope")).toThrow(/Unknown project/);
  });

  it("lists agents without exposing instructions", () => {
    const service = AgentService.loadFromDirectory({ agentsDir });
    const listed = service.listAgents();
    expect(listed.every((a) => "instructions" in a === false)).toBe(true);
    expect(listed[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      role: expect.any(String),
      governanceProfile: expect.stringMatching(/^(read-only|controlled-write)$/),
    });
  });

  it("getAgent throws for unknown agent", () => {
    const service = AgentService.loadFromDirectory({ agentsDir });
    expect(() => service.getAgent("does-not-exist")).toThrow(AgentNotFoundError);
  });

  it("integrates with GovernanceService (read-only path remains deny-closed)", () => {
    const governance = GovernanceService.loadFromDirectory({
      policiesDir,
      isProjectKnown: (id) => id === "kygo",
    });
    const service = AgentService.loadFromDirectory({
      agentsDir,
      policy: {
        governance,
        isProjectKnown: (id) => id === "kygo",
      },
    });

    // Agent allowlist still gates MCP tools.
    expect(service.checkToolPermission("reviewer", "github_get_pull_request").allowed).toBe(true);
    expect(service.checkToolPermission("reviewer", "jira_search_issues").allowed).toBe(false);

    // Governance still evaluates ActionTypes independently.
    expect(
      governance.evaluate({ projectId: "kygo", action: "READ_GITHUB" }).decision,
    ).toBe("ALLOW");
    expect(
      governance.evaluate({ projectId: "kygo", action: "MERGE_PULL_REQUEST" }).decision,
    ).toBe("HUMAN_APPROVAL");
  });

  it("enforces read-only profile against write-like tool names", () => {
    expect(() =>
      validateAgentYaml(
        {
          id: "writer",
          name: "Writer",
          description: "Should fail",
          role: "tester",
          allowedTools: ["jira_update_issue"],
          governanceProfile: "read-only",
        },
        { knownTools: new Set(["jira_update_issue"]) },
      ),
    ).toThrow(/write-like/);
  });

  it("all referenced agent tools exist in known catalog", () => {
    const service = AgentService.loadFromDirectory({ agentsDir });
    const known = new Set<string>(DEFAULT_KNOWN_MCP_TOOLS);
    for (const summary of service.listAgents()) {
      for (const tool of service.getAllowedTools(summary.id)) {
        expect(known.has(tool), `${summary.id} -> ${tool}`).toBe(true);
      }
    }
  });
});
