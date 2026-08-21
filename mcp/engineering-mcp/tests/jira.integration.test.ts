/**
 * Optional live Jira integration test.
 * Disabled by default. Set JIRA_INTEGRATION_TEST=true and provide credentials to enable.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectConfigLoader, ProjectConfigService } from "engineering-platform/config";
import {
  createJiraClientFromEnv,
  JiraService,
} from "../src/integrations/jira/jira.service.js";

const enabled = process.env.JIRA_INTEGRATION_TEST === "true";

describe.runIf(enabled)("Jira live integration", () => {
  it("fetches current user with real credentials", async () => {
    const projectsDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../projects",
    );
    const client = createJiraClientFromEnv({
      JIRA_BASE_URL: process.env.JIRA_BASE_URL,
      JIRA_EMAIL: process.env.JIRA_EMAIL,
      JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,
      JIRA_REQUEST_TIMEOUT_MS: Number(process.env.JIRA_REQUEST_TIMEOUT_MS ?? 10_000),
    });

    expect(client).not.toBeNull();

    const service = new JiraService({
      projectConfigService: new ProjectConfigService({
        loader: new ProjectConfigLoader({ projectsDir }),
      }),
      client,
    });

    const user = await service.getCurrentUser();
    expect(user.accountId.length).toBeGreaterThan(0);
  });
});
