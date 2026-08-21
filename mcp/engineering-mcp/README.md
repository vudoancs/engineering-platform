# engineering-mcp

Shared Engineering MCP server for the `engineering-platform`.

This package is an AI access layer. It is **not** a Jira/GitHub/Confluence database, an AI agent, or a workflow engine.

## Purpose

`engineering-mcp` exposes project-aware tools for engineering systems. Current scope:

- Jira (READ-ONLY)
- GitHub (planned)
- Confluence (planned)
- Engineering Intelligence (planned)
- Governance (planned)

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
    ├── GitHub (planned)
    └── Confluence (planned)
```

## Project awareness

Tools accept a `projectId` such as `kygo` or `clubsync`.

The server does **not** hard-code project names. It resolves configuration through:

```ts
projectConfigService.getJiraConfig(projectId)
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

Jira tools in this phase only require `READ`.

## Security model

- Credentials never belong in project YAML files
- Do not log tokens, passwords, or authorization headers
- Write/delete/execute are denied by default
- Jira tools enforce project boundary checks

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
        "JIRA_API_TOKEN": "your-token"
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
        "JIRA_API_TOKEN": "your-token"
      }
    }
  }
}
```

Clients speak MCP over STDIO with this process. Do not write application logs to stdout.
