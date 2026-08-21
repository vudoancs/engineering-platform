# engineering-platform

Shared internal Engineering Platform for multiple projects.

MCP is one component of the platform. Agents are **definitions and policy** (not always-on autonomous services).

Projects such as Kygo and ClubSync can use this platform through project-specific configuration under `projects/`.

See **[CHANGELOG.md](./CHANGELOG.md)** for notable changes (Keep a Changelog). Update it with every meaningful change.

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

## Controlled Write Operations

```
Agent
 ↓
Workflow
 ↓
Governance
 ↓
Execution Guard
 ↓
MCP
 ↓
External System
```

| Class | Behavior |
| --- | --- |
| READ | Allowed via policy (existing tools) |
| LOW-RISK WRITE | Policy-controlled: `github_create_branch`, `github_create_pull_request` |
| MEDIUM/HIGH-RISK WRITE | Approval required: `jira_update_issue` |
| DISABLED | Not exposed as MCP tools: merge, confluence update, deploy, DB migration |

Repository / Jira project / Confluence space are resolved from `projects/<id>.yaml`. Callers cannot supply credentials or override project boundaries.

## AI Cost Governance

Every AI request is associated with:

- project
- member
- agent
- provider
- model

Budget checks happen **before** execution. Actual usage is recorded **after** execution.

Budget hierarchy (any applicable limit may block):

```
Global
 ↓
Project
 ↓
Member
 ↓
Agent
```

```
Agent → Cost Governance → Budget Check → Governance → Execution → Provider → Usage Event
```

Config: `policies/cost-limits.yaml`, `policies/provider-pricing.yaml` (placeholder prices — not claimed accurate).

MCP READ-ONLY tools: `engineering_get_ai_*`. Slack helpers: `/engineering cost`, `/engineering kygo cost`, `/engineering cost month`.

## Workflows

A workflow is a **deterministic sequence of steps** (state machine), not a distributed orchestrator.

```
Jira
 ↓
Developer
 ↓
Approval
 ↓
Implementation
 ↓
PR
 ↓
Reviewer
 ↓
Approval
 ↓
Merge
 ↓
Jira
```

- Workflows are explicit: `run(instanceId)` advances **one** step
- Workflows are auditable (AuditService events)
- Workflows stop at approval gates until humans approve/reject
- Workflows do not run continuously, spawn agents, or require Gas Town/Gas City
- Write actions are declared but disabled / `NOT_IMPLEMENTED` until write MCP tools exist

Definitions: `workflows/*/workflow.yaml` · Runtime: `engineering-platform/workflows`
