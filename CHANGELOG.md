# Changelog

All notable changes to **engineering-platform** are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Controlled Write MCP + Execution Guard (`src/execution`, `engineering-platform/execution`)
  - Enabled: `github_create_branch`, `github_create_pull_request`, `jira_update_issue`
  - Disabled (not registered): merge, confluence update, deploy, database migration
  - Fail-closed guard: project boundary, agent allowlist, governance, approval lookup, idempotency, dry-run
- GitHub/Jira write helpers (`github.write.ts`, `jira.write.ts`); Confluence write stub (not exposed)
- Developer agent `controlled-write` profile with create-branch / create-PR tools
- Slack message helpers for PR created / Jira approval / disabled merge (no Slack execution)

### Changed

- `jira-to-pr` workflow: create-branch + create-PR enabled; merge remains disabled
- README: Controlled Write Operations section

### Previously in this section (shipped)

- Workflow orchestration layer and READ-ONLY workflow MCP tools (`WORKFLOWS_DIR`)

## [0.1.0] - 2026-08-21

### Added

- Project configuration (`projects/*.yaml`, `ProjectConfigService`)
- Engineering MCP foundation (`mcp/engineering-mcp`)
- Jira READ-ONLY integration (project-key isolation)
- GitHub READ-ONLY integration (repository allowlist isolation)
- Confluence READ-ONLY integration (space isolation)
- Engineering Intelligence aggregation tools (`engineering_get_*`)
- Governance layer (fail-closed policies, approval model, audit abstraction)
- Agent layer definitions: `engineering-manager`, `developer`, `reviewer`
  - Allowlist enforcement in code; MCP tool `engineering_list_agents`

### Notes

- No Gas Town / Gas City / agent swarms / always-on autonomous agents
- No LLM runtime embedded in the platform
- No write MCP tools to external systems yet
