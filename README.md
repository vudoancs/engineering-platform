# engineering-platform

Shared internal Engineering Platform for multiple projects.

MCP is one component of the platform. Agents are **definitions and policy** (not always-on autonomous services).

Projects such as Kygo and ClubSync can use this platform through project-specific configuration under `projects/`.

## Project configuration

Routing metadata lives in `projects/<project-id>.yaml` and is loaded by `src/config/project-config`.

Credentials never belong in project YAML files. Use environment variables or secret management.

## Agents

Agent contracts live under `agents/<id>/` (`agent.yaml` + `instructions.md`) and are loaded by `src/agents` (`engineering-platform/agents`).

### Engineering Manager Agent

Helps managers understand delivery, identify risks, blocked/stale work, PR/CI issues, and documentation gaps. Prefer Engineering Intelligence tools; use raw Jira/GitHub/Confluence only for evidence.

### Developer Agent

Helps developers understand Jira requirements, inspect code/PRs/CI, and propose implementation approaches. **READ-ONLY** in v1 (no merge/deploy/write tools).

### Reviewer Agent

Helps review PRs for correctness, architecture, security, performance, and testing gaps. Does **not** approve or merge automatically.

### Architecture

```
Agent
 ↓
MCP
 ↓
Governance
 ↓
External Systems
```

Security is layered: agent tool allowlist + project boundary (`ProjectConfigService`) + Governance. Any failure DENY.

Agents are invoked explicitly. There is no autonomous loop, swarm framework, or LLM runtime in this package.
