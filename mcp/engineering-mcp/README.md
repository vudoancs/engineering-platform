# engineering-mcp

Shared Engineering MCP server for the `engineering-platform`.

This package is an AI access layer. It is **not** a Jira/GitHub/Confluence database, an AI agent, or a workflow engine.

## Purpose

`engineering-mcp` exposes project-aware tools for engineering systems. Current scope:

- Jira (READ-ONLY)
- GitHub (READ-ONLY)
- Confluence (READ-ONLY)
- Engineering Intelligence (READ-ONLY aggregation)
- Governance (deterministic policy / fail closed)
- Workflows (planned)

## Architecture

```text
AI Client (Cursor / Claude Code / ...)
    ↓ STDIO
engineering-mcp
    ↓ ProjectContextService
ProjectConfigService (platform)
    ↓
Integrations
    ├── Jira (READ-ONLY)
    ├── GitHub (READ-ONLY)
    └── Confluence (READ-ONLY)
         ↓
Engineering Intelligence (aggregation / domain)
         ↓
Governance (policy evaluate — fail closed)
```

## Project awareness

Tools accept a `projectId` such as `kygo` or `clubsync`.

The server does **not** hard-code project names. It resolves configuration through:

```ts
projectConfigService.getJiraConfig(projectId)
projectConfigService.getGithubConfig(projectId)
projectConfigService.getConfluenceConfig(projectId)
```

Adding a project only requires `projects/<project-id>.yaml` in the platform repo.

## Jira integration (READ-ONLY v1)

Jira is the source of truth for engineering work items.

- `projectId` determines the Jira project key via project YAML
- AI cannot cross project boundaries
- Jira integration is **READ-ONLY** in v1
- Credentials come from environment variables, never from project YAML

### Environment

```env
JIRA_BASE_URL=
JIRA_EMAIL=
JIRA_API_TOKEN=
JIRA_REQUEST_TIMEOUT_MS=10000
```

The MCP server starts even when Jira credentials are omitted. Jira tools then return a clear configuration error.

### Tools

| Tool | Purpose |
|------|---------|
| `jira_search_issues` | Search issues (JQL constrained to project) |
| `jira_get_issue` | Get issue details |
| `jira_get_project` | Get Jira project metadata |
| `jira_get_sprint` | Get sprint + issues |
| `jira_get_issue_comments` | List issue comments |
| `jira_get_issue_transitions` | List available transitions (no execution) |
| `jira_get_current_user` | Get authenticated Jira user |

Write tools (`jira_create_issue`, `jira_update_issue`, `jira_transition_issue`, `jira_delete_issue`) are intentionally not implemented.

### Example calls

`jira_search_issues`

```json
{
  "projectId": "kygo",
  "jql": "status = 'In Progress'",
  "maxResults": 20
}
```

Effective JQL becomes:

```text
project = "KYGO" AND (status = 'In Progress')
```

`jira_get_issue`

```json
{
  "projectId": "kygo",
  "issueKey": "KYGO-123"
}
```

Requesting `CLUBSYNC-123` with `projectId: "kygo"` is rejected.

### Project isolation

- Issue keys must belong to the configured Jira project for `projectId`
- Conflicting JQL `project` clauses are rejected
- `project in (...)` with multiple projects is rejected

## GitHub integration (READ-ONLY v1)

GitHub is the source of truth for code delivery.

- `projectId` determines allowed repositories via project YAML
- repository access is project-scoped
- GitHub integration is **READ-ONLY** in v1
- Credentials come from environment variables, never from project YAML

### Environment

```env
GITHUB_TOKEN=
GITHUB_API_URL=https://api.github.com
GITHUB_REQUEST_TIMEOUT_MS=10000
GITHUB_MAX_FILE_BYTES=102400
```

The MCP server starts even when GitHub credentials are omitted. GitHub tools then return a clear configuration error.

### Tools

| Tool | Purpose |
|------|---------|
| `github_list_repositories` | List allowlisted repositories for a project |
| `github_get_repository` | Get repository details |
| `github_list_branches` | List branches |
| `github_get_branch` | Get a branch |
| `github_list_commits` | List commits |
| `github_get_commit` | Get a commit (no patch content) |
| `github_list_pull_requests` | List pull requests |
| `github_get_pull_request` | Get a pull request |
| `github_list_pull_request_reviews` | List PR reviews |
| `github_get_pull_request_checks` | Get CI/check-run status for a PR |
| `github_get_file` | Get a text file (size-limited) |
| `github_list_contributors` | List contributors |

Write tools (create/update/merge PR, push commits, etc.) are intentionally not implemented.

### Example calls

`github_list_pull_requests`

```json
{
  "projectId": "kygo",
  "repository": "kygo",
  "state": "open",
  "perPage": 20
}
```

`github_get_pull_request_checks`

```json
{
  "projectId": "kygo",
  "repository": "kygo",
  "pullRequestNumber": 123
}
```

### Repository isolation

- Only repositories listed in `projects/<projectId>.yaml` are accessible
- `projectId: kygo` + `repository: clubsync` is rejected when not allowlisted
- Organization and repository routing come from `ProjectConfigService`

## Confluence Integration

Confluence is the source of truth for engineering documentation.

- `projectId` determines the allowed Confluence space via project YAML
- Project isolation prevents cross-project document access
- Confluence integration is **READ-ONLY** in v1
- Credentials come from environment variables, never from project YAML

### Environment

```env
CONFLUENCE_BASE_URL=
CONFLUENCE_EMAIL=
CONFLUENCE_API_TOKEN=
CONFLUENCE_REQUEST_TIMEOUT_MS=10000
CONFLUENCE_MAX_PAGE_SIZE_BYTES=204800
```

The MCP server starts even when Confluence credentials are omitted. Confluence tools then return a clear configuration error.

### Tools

| Tool | Purpose |
|------|---------|
| `confluence_get_space` | Get the configured Confluence space for a project |
| `confluence_search_pages` | Search pages within the project's space only |
| `confluence_get_page` | Get page content (readable text; size-limited) |
| `confluence_get_page_children` | List direct child pages |
| `confluence_get_page_ancestors` | List ancestor pages (hierarchy) |
| `confluence_get_page_labels` | List page labels |

Write tools (create/update/delete page, comments, labels, move) are intentionally not implemented.

### Example calls

`confluence_search_pages`

```json
{
  "projectId": "kygo",
  "query": "authentication",
  "limit": 20
}
```

Search is automatically constrained to the configured space (for example `KYGO` when `projectId` is `kygo`). Callers must not supply an arbitrary `spaceKey`.

`confluence_get_page`

```json
{
  "projectId": "kygo",
  "pageId": "123456"
}
```

Pages outside the configured space are rejected.

### Space isolation

- Space keys are resolved only through `ProjectConfigService`
- `projectId: kygo` may only access its configured space
- Cross-space access raises `CONFLUENCE_PROJECT_BOUNDARY_VIOLATION`
- Search CQL is built server-side and always includes the project space filter

## Engineering Intelligence

Engineering Intelligence is a **domain aggregation layer**, not another HTTP integration.

| Source | Role |
|--------|------|
| Jira | Work items / sprint / blockers |
| GitHub | Code delivery / PRs / CI / contributors |
| Confluence | Documentation signals |

```text
AI Client
  ↓
Engineering Intelligence tools
  ↓
EngineeringService
  ↓
JiraService / GitHubService / ConfluenceService
```

It must **not** call Jira/GitHub/Confluence HTTP APIs directly. It is deterministic (no LLM).

### Environment (thresholds)

```env
PR_STALE_HOURS=48
PR_HIGH_RISK_HOURS=72
PR_LARGE_CHANGES=500
PR_REVIEW_WAITING_HOURS=24
ENGINEERING_STALE_DAYS=7
```

### Tools

| Tool | Purpose |
|------|---------|
| `engineering_get_project_status` | Project snapshot (work, delivery, quality, docs, risks) |
| `engineering_get_sprint_status` | Sprint progress (+ openSprints fallback) |
| `engineering_get_team_status` | Operational assignees/contributors (not performance ranking) |
| `engineering_get_delivery_status` | Jira + GitHub delivery aggregation |
| `engineering_get_stale_work` | Non-done issues not updated for N days |
| `engineering_get_blocked_work` | Explicitly blocked issues only |
| `engineering_get_pr_status` | PR review/CI/risk + Jira key correlation |
| `engineering_get_risk_report` | Deterministic risk report with evidence |

### Example calls

`engineering_get_project_status`

```json
{
  "projectId": "kygo"
}
```

`engineering_get_delivery_status`

```json
{
  "projectId": "kygo"
}
```

`engineering_get_pr_status`

```json
{
  "projectId": "kygo",
  "state": "open"
}
```

### Degradation

When a source is missing or fails, aggregate responses include `sources` health (`ok` / `degraded` / `unavailable` / `not_configured`) and section-level `status: "unknown"` — they do not invent metrics.

### Risk rules (deterministic)

- `BLOCKED_TICKET` → high
- `STALE_TICKET` → medium
- `PR_CI_FAILED` / `PR_CHANGES_REQUESTED` / old PR → high
- `PR_STALE` / `PR_REVIEW_OVERDUE` → medium
- `LARGE_PR` → low/medium

## Governance

AI is **not trusted by default**. Governance is a deterministic policy layer (no LLM).

- Read operations are allowed by policy
- Mutating operations require policy evaluation
- High-risk operations require human approval
- Destructive operations are denied
- Unknown actions and invalid policies **fail closed** (DENY)

```text
AI Agent
   ↓
Tool request
   ↓
GovernanceService.evaluate
   ↓
ALLOW | HUMAN_APPROVAL | DENY
   ↓
Approval (metadata only in v1)
   ↓
Execution (future write tools — not implemented yet)
```

Policies live in platform `policies/`:

- `permissions.yaml`
- `approval-rules.yaml`
- `governance.yaml`

### MCP tool

`engineering_check_permission`

```json
{
  "projectId": "kygo",
  "action": "MERGE_PULL_REQUEST",
  "context": {
    "repository": "kygo",
    "pullRequestNumber": 123
  }
}
```

Returns `{ decision, action, projectId, riskLevel, requiresApproval, reason }`.

This tool does **not** execute merges/deploys/writes — it only evaluates policy.

## Read-only mode

Default:

```env
MCP_READ_ONLY=true
```

| Action  | Default behavior                          |
|---------|-------------------------------------------|
| READ    | allowed                                   |
| WRITE   | denied when `MCP_READ_ONLY=true`          |
| DELETE  | denied                                    |
| EXECUTE | denied                                    |

Jira, GitHub, Confluence, Engineering Intelligence, and Governance probe tools in this phase only require `READ`.

## Security model

- Credentials never belong in project YAML files
- Do not log tokens, passwords, or authorization headers
- Write/delete/execute are denied by default
- Integration tools enforce project boundaries; Engineering Intelligence aggregates within those boundaries
- Governance evaluates actions fail-closed; future write tools must call `GovernanceService` before execution

## How to run locally

From `mcp/engineering-mcp`:

```bash
# Build platform config package first
npm run build --prefix ../..

# Install and build this package
npm install
npm run build

# Dry-run (creates server, lists tools, exits)
npm run start:dry-run

# STDIO mode (for MCP clients)
npm start
```

## MCP client configuration (examples)

Labeled as examples — verify against your client's current docs before using in production.

### Cursor (example)

```json
{
  "mcpServers": {
    "engineering-mcp": {
      "command": "node",
      "args": [
        "/absolute/path/to/engineering-platform/mcp/engineering-mcp/dist/main.js"
      ],
      "env": {
        "MCP_READ_ONLY": "true",
        "LOG_LEVEL": "info",
        "JIRA_BASE_URL": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "you@example.com",
        "JIRA_API_TOKEN": "your-token",
        "GITHUB_TOKEN": "your-github-token",
        "GITHUB_API_URL": "https://api.github.com",
        "CONFLUENCE_BASE_URL": "https://your-domain.atlassian.net",
        "CONFLUENCE_EMAIL": "you@example.com",
        "CONFLUENCE_API_TOKEN": "your-token"
      }
    }
  }
}
```

### Claude Code (example)

```json
{
  "mcpServers": {
    "engineering-mcp": {
      "command": "node",
      "args": [
        "/absolute/path/to/engineering-platform/mcp/engineering-mcp/dist/main.js"
      ],
      "env": {
        "MCP_READ_ONLY": "true",
        "JIRA_BASE_URL": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "you@example.com",
        "JIRA_API_TOKEN": "your-token",
        "GITHUB_TOKEN": "your-github-token",
        "GITHUB_API_URL": "https://api.github.com",
        "CONFLUENCE_BASE_URL": "https://your-domain.atlassian.net",
        "CONFLUENCE_EMAIL": "you@example.com",
        "CONFLUENCE_API_TOKEN": "your-token"
      }
    }
  }
}
```

Clients speak MCP over STDIO with this process. Do not write application logs to stdout.
