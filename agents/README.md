# agents

AI agent **definitions** for engineering workflows — not always-on autonomous services.

Agents are lightweight contracts composed of:

```
Agent Definition
+ Instructions
+ MCP Tools
+ Engineering Intelligence
+ Governance
+ Human Approval
```

## Architecture

```
Agent
 ↓
MCP tools
 ↓
Governance
 ↓
External systems (Jira / GitHub / Confluence)
```

Agents never call Jira/GitHub/Confluence clients directly. They use MCP tools.
Agents never bypass Governance. Future write actions flow:

```
Agent → Governance → Approval → Tool execution
```

## Implemented agents (v1)

| Agent | Role | Governance |
| --- | --- | --- |
| `engineering-manager` | Delivery status, risks, blocked/stale work, management reports | `read-only` |
| `developer` | Requirements, code/PR inspection, implementation proposals | `read-only` |
| `reviewer` | PR review for correctness, security, performance, testing | `read-only` |

Each agent lives in `agents/<id>/`:

- `agent.yaml` — identity, allowlisted tools, governance profile
- `instructions.md` — responsibilities and required output structure

## Runtime

Platform package: `engineering-platform/agents`

- Loads and validates agent YAML + instructions
- Enforces tool allowlists in code (not only prompts)
- Requires `projectId` for execution context
- Does **not** include an LLM runtime or autonomous loop

MCP tool: `engineering_list_agents` (READ-ONLY) returns id/name/role/governanceProfile only.

## Explicitly out of scope (v1)

- Gas Town / Gas City / agent swarms
- Always-on workers, cron, queues
- Agent-to-agent auto-handoff (types reserved for later)
- OpenAI / Claude / LangChain SDKs in the platform
