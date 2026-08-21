# jira integration

Purpose: READ-ONLY Jira Cloud REST API client and service used by MCP tools.

Credentials come from environment variables (`JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`).
Project routing uses `ProjectConfigService` (`projectId` → `jira.projectKey`).
