import { describe, expect, it } from "vitest";
import {
  ProjectConfigError,
  ProjectConfigSchema,
} from "../../src/config/project-config/index.js";
import { ProjectConfigLoader } from "../../src/config/project-config/project-config.loader.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const validKygo = {
  id: "kygo",
  name: "Kygo",
  description: "Kygo engineering project",
  jira: { projectKey: "KYGO" },
  github: {
    organization: "your-github-org",
    repositories: ["kygo"],
  },
  confluence: { spaceKey: "KYGO" },
  settings: { enabled: true },
};

const validClubSync = {
  id: "clubsync",
  name: "ClubSync",
  description: "ClubSync engineering project",
  jira: { projectKey: "CLUBSYNC" },
  github: {
    organization: "your-github-org",
    repositories: ["clubsync"],
  },
  confluence: { spaceKey: "CLUBSYNC" },
  settings: { enabled: true },
};

describe("ProjectConfigSchema", () => {
  it("accepts valid Kygo configuration", () => {
    const result = ProjectConfigSchema.parse(validKygo);
    expect(result.id).toBe("kygo");
    expect(result.jira?.projectKey).toBe("KYGO");
    expect(result.settings.enabled).toBe(true);
  });

  it("accepts valid ClubSync configuration", () => {
    const result = ProjectConfigSchema.parse(validClubSync);
    expect(result.id).toBe("clubsync");
    expect(result.github?.repositories).toEqual(["clubsync"]);
  });

  it("rejects missing id", () => {
    const { id: _id, ...withoutId } = validKygo;
    const result = ProjectConfigSchema.safeParse(withoutId);
    expect(result.success).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _name, ...withoutName } = validKygo;
    const result = ProjectConfigSchema.safeParse(withoutName);
    expect(result.success).toBe(false);
  });

  it("rejects invalid Jira configuration", () => {
    const result = ProjectConfigSchema.safeParse({
      ...validKygo,
      jira: { projectKey: "" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid GitHub configuration", () => {
    const result = ProjectConfigSchema.safeParse({
      ...validKygo,
      github: { organization: "", repositories: ["kygo"] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty GitHub repositories", () => {
    const result = ProjectConfigSchema.safeParse({
      ...validKygo,
      github: { organization: "company", repositories: [] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid Confluence configuration", () => {
    const result = ProjectConfigSchema.safeParse({
      ...validKygo,
      confluence: { spaceKey: "" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing Jira/GitHub/Confluence", () => {
    const result = ProjectConfigSchema.safeParse({
      id: "kygo",
      name: "Kygo",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown top-level properties", () => {
    const result = ProjectConfigSchema.safeParse({
      ...validKygo,
      unknownProperty: "test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid project ID format", () => {
    const invalidIds = ["Kygo", "KYGO", "kygo_project", "-kygo", "kygo-", "ky go"];

    for (const id of invalidIds) {
      const result = ProjectConfigSchema.safeParse({
        ...validKygo,
        id,
      });
      expect(result.success, `expected invalid id: ${id}`).toBe(false);
    }
  });

  it("defaults settings.enabled to true", () => {
    const { settings: _settings, ...withoutSettings } = validKygo;
    const result = ProjectConfigSchema.parse(withoutSettings);
    expect(result.settings.enabled).toBe(true);
  });

  it("detects duplicate project IDs when loading all projects", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "project-config-dup-"));
    writeFileSync(
      path.join(dir, "kygo.yaml"),
      `id: kygo\nname: Kygo\njira:\n  projectKey: KYGO\n`,
      "utf8",
    );
    writeFileSync(
      path.join(dir, "another-kygo.yaml"),
      `id: kygo\nname: Another Kygo\njira:\n  projectKey: KYGO\n`,
      "utf8",
    );

    const loader = new ProjectConfigLoader({ projectsDir: dir });
    expect(() => loader.loadAllProjects()).toThrow(ProjectConfigError);
    expect(() => loader.loadAllProjects()).toThrow(/Duplicate project ID/);
  });
});
