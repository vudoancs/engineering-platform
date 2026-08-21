# Changelog

All notable changes to **engineering-platform** are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Workflow orchestration layer (`src/workflows`, `engineering-platform/workflows`)
  - Definitions: `workflows/jira-to-pr`, `workflows/pr-review`
  - Deterministic one-step runner (no workers / loops / Temporal / Redis)
  - Approval store, audit events, retry, idempotency, condition gates
  - Write actions as `NOT_IMPLEMENTED` placeholders (`enabled: false` where applicable)
- MCP READ-ONLY tools: `engineering_list_workflows`, `engineering_get_workflow`, `engineering_get_workflow_instance`
- Env: `WORKFLOWS_DIR`

### Changed

- README / MCP docs: document Workflows architecture and constraints

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
