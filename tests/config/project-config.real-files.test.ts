import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ProjectConfigLoader,
  ProjectConfigService,
  ProjectNotFoundError,
} from "../../src/config/project-config/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const projectsDir = path.join(repoRoot, "projects");

describe("real projects/ configurations", () => {
  const loader = new ProjectConfigLoader({ projectsDir });
  const service = new ProjectConfigService({ loader });

  it("loads Kygo config", () => {
    const project = service.getProject("kygo");
    expect(project).toMatchObject({
      id: "kygo",
      name: "Kygo",
      jira: { projectKey: "KYGO" },
      github: {
        organization: "your-github-org",
        repositories: ["kygo"],
      },
      confluence: { spaceKey: "KYGO" },
      settings: { enabled: true },
    });
  });

  it("loads ClubSync config", () => {
    const project = service.getProject("clubsync");
    expect(project).toMatchObject({
      id: "clubsync",
      name: "ClubSync",
      jira: { projectKey: "CLUBSYNC" },
      github: {
        organization: "your-github-org",
        repositories: ["clubsync"],
      },
      confluence: { spaceKey: "CLUBSYNC" },
      settings: { enabled: true },
    });
  });

  it("lists both projects and ignores schema/", () => {
    expect(loader.listProjectIds()).toEqual(["clubsync", "kygo"]);
    expect(loader.loadAllProjects().map((project) => project.id)).toEqual([
      "clubsync",
      "kygo",
    ]);
  });

  it("throws ProjectNotFoundError for unknown IDs", () => {
    expect(() => service.getProject("missing-project")).toThrow(ProjectNotFoundError);
  });
});
