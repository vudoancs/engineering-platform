import { describe, expect, it } from "vitest";
import { McpError, McpResourceNotFoundError } from "../src/errors/mcp-errors.js";
import {
  ResourceRegistry,
  type EngineeringResource,
} from "../src/server/resource-registry.js";

const demoResource: EngineeringResource = {
  id: "demo",
  name: "demo",
  uri: "engineering://demo",
  description: "demo resource",
  read: async () => ({
    contents: [{ uri: "engineering://demo", text: "ok", mimeType: "text/plain" }],
  }),
};

describe("ResourceRegistry", () => {
  it("registers and lists resources", () => {
    const registry = new ResourceRegistry();
    registry.register(demoResource);
    expect(registry.size()).toBe(1);
    expect(registry.get("demo").uri).toBe("engineering://demo");
  });

  it("rejects duplicate resource ids", () => {
    const registry = new ResourceRegistry();
    registry.register(demoResource);
    expect(() => registry.register(demoResource)).toThrow(McpError);
    expect(() => registry.register(demoResource)).toThrow(/Duplicate resource/);
  });

  it("rejects duplicate resource URIs", () => {
    const registry = new ResourceRegistry();
    registry.register(demoResource);
    expect(() =>
      registry.register({
        ...demoResource,
        id: "other",
      }),
    ).toThrow(/Duplicate resource URI/);
  });

  it("throws McpResourceNotFoundError", () => {
    const registry = new ResourceRegistry();
    expect(() => registry.get("missing")).toThrow(McpResourceNotFoundError);
  });
});
