/**
 * Jira API response shapes (partial) and compact domain models for MCP.
 */

export interface JiraUserRef {
  accountId?: string;
  displayName?: string;
  emailAddress?: string;
  active?: boolean;
  timeZone?: string;
}

export interface JiraStatusCategory {
  key?: string;
  name?: string;
}

export interface JiraStatus {
  name?: string;
  statusCategory?: JiraStatusCategory;
}

export interface JiraIssueType {
  name?: string;
}

export interface JiraPriority {
  name?: string;
}

export interface JiraComponent {
  name?: string;
}

export interface JiraProjectRef {
  key?: string;
  name?: string;
  id?: string;
  projectTypeKey?: string;
  description?: string;
  lead?: JiraUserRef;
  self?: string;
}

export interface JiraIssueFields {
  summary?: string;
  description?: unknown;
  status?: JiraStatus;
  issuetype?: JiraIssueType;
  priority?: JiraPriority;
  assignee?: JiraUserRef | null;
  reporter?: JiraUserRef | null;
  labels?: string[];
  components?: JiraComponent[];
  created?: string;
  updated?: string;
  duedate?: string | null;
  project?: JiraProjectRef;
  comment?: {
    comments?: JiraCommentApi[];
  };
}

export interface JiraIssueApi {
  id?: string;
  key: string;
  self?: string;
  fields?: JiraIssueFields;
}

export interface JiraSearchApiResponse {
  issues?: JiraIssueApi[];
  nextPageToken?: string;
  isLast?: boolean;
  /** Present on legacy search responses. */
  total?: number;
}

export interface JiraApproximateCountResponse {
  count?: number;
}

export interface JiraCommentApi {
  id: string;
  author?: JiraUserRef;
  body?: unknown;
  created?: string;
  updated?: string;
}

export interface JiraCommentsApiResponse {
  comments?: JiraCommentApi[];
  total?: number;
}

export interface JiraTransitionApi {
  id: string;
  name: string;
  to?: JiraStatus;
}

export interface JiraTransitionsApiResponse {
  transitions?: JiraTransitionApi[];
}

export interface JiraSprintApi {
  id: number;
  name?: string;
  state?: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  goal?: string;
  originBoardId?: number;
}

export interface JiraSprintIssuesApiResponse {
  issues?: JiraIssueApi[];
  total?: number;
}

/** Compact domain models returned to MCP tools. */

export interface CompactIssueSummary {
  key: string;
  summary: string;
  status: string;
  statusCategory?: string;
  issueType: string;
  priority?: string;
  assignee?: string;
  reporter?: string;
  labels: string[];
  createdAt?: string;
  updatedAt?: string;
  dueDate?: string;
}

export interface CompactIssueDetail extends CompactIssueSummary {
  projectId: string;
  description?: string;
  components: string[];
  url: string;
}

export interface CompactIssueSearchResult {
  projectId: string;
  total: number;
  issues: CompactIssueSummary[];
}

export interface CompactProject {
  projectId: string;
  jiraProjectKey: string;
  name: string;
  description?: string;
  lead?: string;
  projectType?: string;
  url: string;
}

export interface CompactComment {
  id: string;
  author?: string;
  body: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CompactCommentsResult {
  issueKey: string;
  comments: CompactComment[];
}

export interface CompactTransition {
  id: string;
  name: string;
  toStatus: string;
}

export interface CompactTransitionsResult {
  issueKey: string;
  transitions: CompactTransition[];
}

export interface CompactSprintIssue {
  key: string;
  summary: string;
  status: string;
  assignee?: string;
}

export interface CompactSprint {
  id: number;
  name: string;
  state?: string;
  startDate?: string;
  endDate?: string;
  goal?: string;
  issues: CompactSprintIssue[];
}

export interface CompactCurrentUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  active: boolean;
  timeZone?: string;
}
