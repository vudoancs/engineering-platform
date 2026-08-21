# engineering-platform

Shared internal Engineering Platform for multiple projects.

MCP is one component of the platform. AI agents and workflows will be added later.

Projects such as Kygo and ClubSync can use this platform through project-specific configuration under `projects/`.

## Project configuration

Routing metadata lives in `projects/<project-id>.yaml` and is loaded by `src/config/project-config`.

Credentials never belong in project YAML files. Use environment variables or secret management.
