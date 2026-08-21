# policies

Purpose: First-class governance policies applied across agents and workflows.

## Runtime policy files (v1)

| File | Role |
|------|------|
| `permissions.yaml` | Action → ALLOW / HUMAN_APPROVAL / DENY + riskLevel |
| `approval-rules.yaml` | Approval requirements and future preconditions |
| `governance.yaml` | Fail-closed defaults and project scoping hooks |

These files are loaded by `engineering-platform/governance` (`PolicyLoader`). Invalid configuration fails closed (deny), never allow.

Subfolders (`ai-governance/`, `security/`, etc.) hold narrative/process docs for humans.
