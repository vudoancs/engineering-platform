import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ProjectConfigError,
  ProjectConfigLoader,
  ProjectNotFoundError,
} from "../../src/config/project-config/index.js";

function createProjectsDir(): string {
  return mkdtempSync(path.join(tmpdir(), "project-config-loader-"));
}

const kygoYaml = `
id: kygo
name: Kygo
description: Kygo engineering project
jira:
  projectKey: KYGO
github:
  organization: your-github-org
  repositories:
    - kygo
confluence:
  spaceKey: KYGO
settings:
  enabled: true
`;

const clubsyncYaml = `
id: clubsync
name: ClubSync
description: ClubSync engineering project
jira:
  projectKey: CLUBSYNC
github:
  organization: your-github-org
  repositories:
    - clubsync
confluence:
  spaceKey: CLUBSYNC
settings:
  enabled: true
`;

describe("ProjectConfigLoader", () => {
  it("loads valid YAML", () => {
    const dir = createProjectsDir();
    writeFileSync(path.join(dir, "kygo.yaml"), kygoYaml, "utf8");

    const loader = new ProjectConfigLoader({ projectsDir: dir });
    const project = loader.loadProject("kygo");

    expect(project.id).toBe("kygo");
    expect(project.jira?.projectKey).toBe("KYGO");
    expect(project.github?.repositories).toEqual(["kygo"]);
  });

  it("rejects invalid YAML/config", () => {
    const dir = createProjectsDir();
    writeFileSync(
      path.join(dir, "kygo.yaml"),
      `id: kygo\nname: Kygo\njira:\n  projectKey: ""\n`,
      "utf8",
    );

    const loader = new ProjectConfigLoader({ projectsDir: dir });
    expect(() => loader.loadProject("kygo")).toThrow(ProjectConfigError);
  });

  it("discovers multiple projects", () => {
    const dir = createProjectsDir();
    writeFileSync(path.join(dir, "kygo.yaml"), kygoYaml, "utf8");
    writeFileSync(path.join(dir, "clubsync.yaml"), clubsyncYaml, "utf8");

    const loader = new ProjectConfigLoader({ projectsDir: dir });
    const projects = loader.loadAllProjects();
    const ids = loader.listProjectIds();

    expect(ids).toEqual(["clubsync", "kygo"]);
    expect(projects.map((project) => project.id)).toEqual(["clubsync", "kygo"]);
  });

  it("ignores README.md", () => {
    const dir = createProjectsDir();
    writeFileSync(path.join(dir, "kygo.yaml"), kygoYaml, "utf8");
    writeFileSync(path.join(dir, "README.md"), "# projects\n", "utf8");

    const loader = new ProjectConfigLoader({ projectsDir: dir });
    expect(loader.listProjectIds()).toEqual(["kygo"]);
    expect(loader.loadAllProjects()).toHaveLength(1);
  });

  it("ignores schema directory", () => {
    const dir = createProjectsDir();
    writeFileSync(path.join(dir, "kygo.yaml"), kygoYaml, "utf8");
    const schemaDir = path.join(dir, "schema");
    mkdirSync(schemaDir);
    writeFileSync(
      path.join(schemaDir, "project-config.schema.json"),
      "{}",
      "utf8",
    );
    writeFileSync(
      path.join(schemaDir, "should-ignore.yaml"),
      `id: ignored\nname: Ignored\njira:\n  projectKey: X\n`,
      "utf8",
    );

    const loader = new ProjectConfigLoader({ projectsDir: dir });
    expect(loader.listProjectIds()).toEqual(["kygo"]);
    expect(loader.loadAllProjects().map((project) => project.id)).toEqual(["kygo"]);
  });

  it("throws ProjectNotFoundError for missing project", () => {
    const dir = createProjectsDir();
    writeFileSync(path.join(dir, "kygo.yaml"), kygoYaml, "utf8");

    const loader = new ProjectConfigLoader({ projectsDir: dir });
    expect(() => loader.loadProject("missing")).toThrow(ProjectNotFoundError);
  });
});
