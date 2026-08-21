# Changelog

All notable changes to **engineering-platform** are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- AI Cost Governance (`src/cost`, `engineering-platform/cost`)
  - Usage events, configurable provider pricing, micro-USD cost calculation
  - Budget policies (`policies/cost-limits.yaml`) with GLOBAL/PROJECT/MEMBER/AGENT hierarchy
  - Pre-execution budget ALLOW/WARNING/BLOCK; post-execution idempotent usage recording
  - MCP READ-ONLY tools: `engineering_get_ai_usage|cost|budget|cost_by_*`
  - Slack cost command parser/helpers (no auto-send / no scheduler)
- Policies: `provider-pricing.yaml`, `cost-limits.yaml` (placeholders)

### Changed

- README: AI Cost Governance section
- engineering-manager / developer agent allowlists include cost report tools

### Previously in this section (shipped)

- Controlled Write MCP + Execution Guard
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
