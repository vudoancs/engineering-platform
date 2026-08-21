/**
 * Optional live GitHub integration test.
 * Disabled by default. Set GITHUB_INTEGRATION_TEST=true and provide GITHUB_TOKEN to enable.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectConfigLoader, ProjectConfigService } from "engineering-platform/config";
import {
  createGitHubClientFromEnv,
  GitHubService,
} from "../src/integrations/github/github.service.js";

const enabled = process.env.GITHUB_INTEGRATION_TEST === "true";

describe.runIf(enabled)("GitHub live integration", () => {
  it("lists repositories for a configured project", async () => {
    const projectsDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../projects",
    );
    const client = createGitHubClientFromEnv({
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      GITHUB_API_URL: process.env.GITHUB_API_URL,
      GITHUB_REQUEST_TIMEOUT_MS: Number(process.env.GITHUB_REQUEST_TIMEOUT_MS ?? 10_000),
    });
    expect(client).not.toBeNull();

    const service = new GitHubService({
      projectConfigService: new ProjectConfigService({
        loader: new ProjectConfigLoader({ projectsDir }),
      }),
      client,
    });

    const projectId = process.env.GITHUB_INTEGRATION_PROJECT_ID ?? "kygo";
    const result = await service.getRepositories(projectId);
    expect(result.repositories.length).toBeGreaterThan(0);
  });
});
