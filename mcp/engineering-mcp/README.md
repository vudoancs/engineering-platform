# engineering-mcp

Shared Engineering MCP server for the `engineering-platform`.

This package is an AI access layer. It is **not** a Jira/GitHub/Confluence database, an AI agent, or a workflow engine.

## Purpose

`engineering-mcp` will eventually expose project-aware tools and resources for:

- Jira
- GitHub
- Confluence
- Engineering Intelligence
- Governance

The foundation in this package provides:

- MCP server bootstrap (STDIO)
- Tool / resource registries
- Project awareness via platform `ProjectConfigService`
- Permission foundation (read-only by default)
- Structured logging
- Normalized errors
- Health abstraction

No business tools are registered yet.

## Architecture

```text
AI Client (Cursor / Claude Code / ...)
    ↓ STDIO
engineering-mcp
    ↓ ProjectContextService
ProjectConfigService (platform)
    ↓
Future integrations
    ├── Jira
    ├── GitHub
    └── Confluence
```

Later:

```text
AI Agent → engineering-mcp → Engineering Intelligence → Governance → Integrations
```

## Project awareness

Tools will accept a `projectId` such as `kygo` or `clubsync`.

The server does **not** hard-code project names. It resolves configuration through:

```ts
projectConfigService.getProject(projectId)
```

Adding a project only requires `projects/<project-id>.yaml` in the platform repo.

## Read-only mode

Default:

```env
MCP_READ_ONLY=true
```

Permission foundation:

| Action  | Default behavior                          |
|---------|-------------------------------------------|
| READ    | allowed                                   |
| WRITE   | denied when `MCP_READ_ONLY=true`          |
| DELETE  | denied                                    |
| EXECUTE | denied                                    |

## Security model

- Credentials never belong in project YAML files
- Do not log tokens, passwords, or authorization headers
- Write/delete/execute are denied by default in this foundation
- Future integration ACLs will build on `PermissionService`

## How to run locally

From `mcp/engineering-mcp`:

```bash
# Build platform config package first
npm run build --prefix ../..

# Install and build this package
npm install
npm run build

# Dry-run (creates server, verifies zero business tools, exits)
npm run start:dry-run

# STDIO mode (for MCP clients)
npm start
```

## MCP client configuration (examples)

Labeled as examples — verify against your client's current docs before using in production.

### Cursor (example)

Project or user `mcp.json`:

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
        "LOG_LEVEL": "info"
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
        "MCP_READ_ONLY": "true"
      }
    }
  }
}
```

Clients speak MCP over STDIO with this process. Do not write application logs to stdout.

## Future integrations

Directories are reserved for upcoming work:

- `src/tools/{jira,github,confluence,engineering,governance}`
- `src/integrations/{jira,github,confluence}`
- `src/resources/`

Those modules are intentionally empty placeholders in this foundation.
