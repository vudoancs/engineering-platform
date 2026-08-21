/**
 * Slack-facing message helpers. Never execute writes from Slack.
 */
export function slackMessagePrCreated(prNumber: number, title?: string): string {
  return title
    ? `PR #${prNumber} created: ${title}`
    : `PR #${prNumber} created.`;
}

export function slackMessageJiraApprovalRequired(issueKey: string): string {
  return `Approval required to update ${issueKey}.`;
}

export function slackMessageDisabledAction(action: string): string {
  if (action.includes("merge")) {
    return "Merge is currently disabled by engineering policy.";
  }
  return `Action "${action}" is currently disabled by engineering policy.`;
}

export function slackMessageBranchCreated(branchName: string): string {
  return `Branch \`${branchName}\` created.`;
}
