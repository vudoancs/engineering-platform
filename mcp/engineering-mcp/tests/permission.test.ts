import { describe, expect, it } from "vitest";
import { McpPermissionError } from "../src/errors/mcp-errors.js";
import { PermissionService } from "../src/security/permission.service.js";

describe("PermissionService", () => {
  it("allows READ", () => {
    const service = new PermissionService({ readOnly: true });
    const decision = service.checkPermission("READ");
    expect(decision.allowed).toBe(true);
    expect(decision.requiresHumanApproval).toBe(false);
  });

  it("denies WRITE in read-only mode", () => {
    const service = new PermissionService({ readOnly: true });
    const decision = service.checkPermission("WRITE");
    expect(decision.allowed).toBe(false);
    expect(decision.requiresHumanApproval).toBe(true);
    expect(decision.reason).toMatch(/MCP_READ_ONLY/);
  });

  it("allows WRITE when read-only is disabled", () => {
    const service = new PermissionService({ readOnly: false });
    const decision = service.checkPermission("WRITE");
    expect(decision.allowed).toBe(true);
    expect(decision.requiresHumanApproval).toBe(true);
  });

  it("denies DELETE", () => {
    const service = new PermissionService({ readOnly: false });
    expect(service.checkPermission("DELETE").allowed).toBe(false);
  });

  it("denies EXECUTE", () => {
    const service = new PermissionService({ readOnly: false });
    expect(service.checkPermission("EXECUTE").allowed).toBe(false);
  });

  it("assertAllowed throws McpPermissionError", () => {
    const service = new PermissionService({ readOnly: true });
    expect(() => service.assertAllowed("WRITE")).toThrow(McpPermissionError);
  });
});
