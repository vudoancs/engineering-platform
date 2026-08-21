#!/usr/bin/env node
import { McpServerFactory } from "./server/mcp-server.js";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const factory = new McpServerFactory();
  const runtime = factory.create();

  if (dryRun) {
    const health = runtime.health.health();
    runtime.logger.info("mcp_dry_run_ok", {
      status: health.status,
      toolCount: runtime.tools.size(),
      toolNames: runtime.tools.list().map((tool) => tool.name),
      resourceCount: runtime.resources.size(),
      jiraConfigured: runtime.jira.isConfigured(),
      name: runtime.config.MCP_SERVER_NAME,
      version: runtime.config.MCP_SERVER_VERSION,
    });
    return;
  }

  await factory.connectStdio(runtime);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      message: "mcp_startup_failed",
      error: message,
      timestamp: new Date().toISOString(),
    })}\n`,
  );
  process.exitCode = 1;
});
