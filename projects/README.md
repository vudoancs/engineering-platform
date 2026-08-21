# projects

Purpose: Project-specific configuration for consumers such as Kygo, ClubSync, and others.

## Overview

Project configurations are stored as YAML files under this directory.

Each project has a unique lowercase kebab-case ID. Configuration maps a project to Jira, GitHub, and Confluence routing metadata only.

## Conventions

Project IDs:

- `kygo`
- `clubsync`
- `project-a`

Configuration file naming:

```text
projects/<project-id>.yaml
```

Examples:

- `projects/kygo.yaml`
- `projects/clubsync.yaml`

JSON Schema:

- `projects/schema/project-config.schema.json`

## Security

Credentials must never be stored in project YAML files.

Do not store:

- API tokens
- passwords
- secrets
- private keys
- OAuth credentials

Credentials belong in environment variables or secret management.

## Adding a project

1. Create `projects/<project-id>.yaml`
2. Follow the schema in `schema/project-config.schema.json`
3. Do not modify platform source code

The platform resolves integrations through `ProjectConfigService` using only the project ID.
