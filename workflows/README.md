# Workflows

Deterministic, explicit, auditable workflow definitions — **not** always-on workers.

```
Jira
 ↓
Developer Agent
 ↓
Approval
 ↓
Implementation
 ↓
PR
 ↓
Reviewer Agent
 ↓
Approval
 ↓
Merge (disabled until write tools exist)
 ↓
Jira update (disabled)
```

## Principles

- Workflows are **explicit** — each `run(instanceId)` executes **one** step
- Workflows are **auditable** — events go through AuditService
- Workflows **stop at approval gates** (`WAITING_APPROVAL`)
- Workflows do **not** run continuously
- Workflows do **not** spawn agents or agent swarms
- No Gas Town / Gas City / Temporal / Airflow / Redis orchestration

## Definitions (v1)

| id | Purpose |
| --- | --- |
| `jira-to-pr` | Jira ticket → plan → approval → implement → PR → review → merge (writes disabled) |
| `pr-review` | Load PR/Jira/CI → Reviewer → risk condition → human decision (no auto-merge) |

Each workflow lives in `workflows/<id>/workflow.yaml`.

Runtime package: `engineering-platform/workflows`.

MCP tools (READ-ONLY): `engineering_list_workflows`, `engineering_get_workflow`, `engineering_get_workflow_instance`.

There is **no** `engineering_execute_workflow` yet — execution is via the application/runtime layer.
