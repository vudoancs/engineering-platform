/**
 * Optional live Confluence integration test.
 * Disabled by default. Set CONFLUENCE_INTEGRATION_TEST=true and provide credentials to enable.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ProjectConfigLoader, ProjectConfigService } from "engineering-platform/config";
import {
  createConfluenceClientFromEnv,
  ConfluenceService,
} from "../src/integrations/confluence/confluence.service.js";

const enabled = process.env.CONFLUENCE_INTEGRATION_TEST === "true";

describe.runIf(enabled)("Confluence live integration", () => {
  it("loads space for a configured project", async () => {
    const projectsDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../projects",
    );
    const client = createConfluenceClientFromEnv({
      CONFLUENCE_BASE_URL: process.env.CONFLUENCE_BASE_URL,
      CONFLUENCE_EMAIL: process.env.CONFLUENCE_EMAIL,
      CONFLUENCE_API_TOKEN: process.env.CONFLUENCE_API_TOKEN,
      CONFLUENCE_REQUEST_TIMEOUT_MS: Number(
        process.env.CONFLUENCE_REQUEST_TIMEOUT_MS ?? 10_000,
      ),
    });
    expect(client).not.toBeNull();

    const service = new ConfluenceService({
      projectConfigService: new ProjectConfigService({
        loader: new ProjectConfigLoader({ projectsDir }),
      }),
      client,
    });

    const projectId = process.env.CONFLUENCE_INTEGRATION_PROJECT_ID ?? "kygo";
    const space = await service.getSpace(projectId);
    expect(space.spaceKey.length).toBeGreaterThan(0);
  });
});
