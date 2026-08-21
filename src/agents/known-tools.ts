/**
 * Default catalog of MCP tools known to the platform agent layer.
 * MCP runtime may pass a stricter/current set at construction time.
 */
export const DEFAULT_KNOWN_MCP_TOOLS = [
  // Jira
  "jira_search_issues",
  "jira_get_issue",
  "jira_get_project",
  "jira_get_sprint",
  "jira_get_issue_comments",
  "jira_get_issue_transitions",
  "jira_get_current_user",
  "jira_update_issue",
  // GitHub
  "github_list_repositories",
  "github_get_repository",
  "github_list_branches",
  "github_get_branch",
  "github_list_commits",
  "github_get_commit",
  "github_list_pull_requests",
  "github_get_pull_request",
  "github_list_pull_request_reviews",
  "github_get_pull_request_checks",
  "github_get_file",
  "github_list_contributors",
  "github_create_branch",
  "github_create_pull_request",
  // Confluence
  "confluence_get_space",
  "confluence_search_pages",
  "confluence_get_page",
  "confluence_get_page_children",
  "confluence_get_page_ancestors",
  "confluence_get_page_labels",
  // Engineering Intelligence
  "engineering_get_project_status",
  "engineering_get_sprint_status",
  "engineering_get_team_status",
  "engineering_get_delivery_status",
  "engineering_get_stale_work",
  "engineering_get_blocked_work",
  "engineering_get_pr_status",
  "engineering_get_risk_report",
  "engineering_list_agents",
  "engineering_list_workflows",
  "engineering_get_workflow",
  "engineering_get_workflow_instance",
  // Governance
  "engineering_check_permission",
  // AI Cost Governance
  "engineering_get_ai_usage",
  "engineering_get_ai_cost",
  "engineering_get_ai_budget",
  "engineering_get_ai_cost_by_project",
  "engineering_get_ai_cost_by_agent",
  "engineering_get_ai_cost_by_member",
  "engineering_get_ai_cost_by_provider",
] as const;

export type KnownMcpToolName = (typeof DEFAULT_KNOWN_MCP_TOOLS)[number];
