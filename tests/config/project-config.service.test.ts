import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ProjectConfigLoader,
  ProjectConfigMissingError,
  ProjectConfigService,
  ProjectNotFoundError,
} from "../../src/config/project-config/index.js";

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

const disabledYaml = `
id: disabled-project
name: Disabled Project
jira:
  projectKey: DIS
settings:
  enabled: false
`;

const jiraOnlyYaml = `
id: jira-only
name: Jira Only
jira:
  projectKey: JIRAONLY
`;

function createService(files: Record<string, string>): ProjectConfigService {
  const dir = mkdtempSync(path.join(tmpdir(), "project-config-service-"));

  for (const [filename, contents] of Object.entries(files)) {
    writeFileSync(path.join(dir, filename), contents, "utf8");
  }

  const loader = new ProjectConfigLoader({ projectsDir: dir });
  return new ProjectConfigService({ loader });
}

describe("ProjectConfigService", () => {
  it("getProject returns the project configuration", () => {
    const service = createService({ "kygo.yaml": kygoYaml });
    const project = service.getProject("kygo");

    expect(project.id).toBe("kygo");
    expect(project.name).toBe("Kygo");
  });

  it("getJiraConfig returns Jira routing metadata", () => {
    const service = createService({ "kygo.yaml": kygoYaml });
    expect(service.getJiraConfig("kygo")).toEqual({ projectKey: "KYGO" });
  });

  it("getGithubConfig returns GitHub routing metadata", () => {
    const service = createService({ "kygo.yaml": kygoYaml });
    expect(service.getGithubConfig("kygo")).toEqual({
      organization: "your-github-org",
      repositories: ["kygo"],
    });
  });

  it("getConfluenceConfig returns Confluence routing metadata", () => {
    const service = createService({ "kygo.yaml": kygoYaml });
    expect(service.getConfluenceConfig("kygo")).toEqual({ spaceKey: "KYGO" });
  });

  it("isProjectEnabled respects settings.enabled", () => {
    const service = createService({
      "kygo.yaml": kygoYaml,
      "disabled-project.yaml": disabledYaml,
    });

    expect(service.isProjectEnabled("kygo")).toBe(true);
    expect(service.isProjectEnabled("disabled-project")).toBe(false);
  });

  it("throws ProjectNotFoundError for unknown project IDs", () => {
    const service = createService({ "kygo.yaml": kygoYaml });
    expect(() => service.getProject("missing")).toThrow(ProjectNotFoundError);
    expect(() => service.getJiraConfig("missing")).toThrow(ProjectNotFoundError);
    expect(() => service.isProjectEnabled("missing")).toThrow(ProjectNotFoundError);
  });

  it("throws ProjectConfigMissingError when integration is not configured", () => {
    const service = createService({ "jira-only.yaml": jiraOnlyYaml });
    expect(() => service.getGithubConfig("jira-only")).toThrow(
      ProjectConfigMissingError,
    );
    expect(() => service.getConfluenceConfig("jira-only")).toThrow(
      ProjectConfigMissingError,
    );
  });
});
