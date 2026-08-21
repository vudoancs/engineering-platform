/**
 * Jira controlled write helpers. Not a generic REST proxy.
 * Allowed fields only: status (via transition), comment, labels.
 */

export interface JiraWriteClient {
  get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
}

export interface JiraControlledUpdateInput {
  issueKey: string;
  fields: {
    status?: string;
    comment?: string;
    labels?: string[];
  };
}

export async function jiraControlledUpdateIssue(
  client: JiraWriteClient,
  input: JiraControlledUpdateInput,
): Promise<{ issueKey: string; updated: string[] }> {
  const updated: string[] = [];
  const { issueKey, fields } = input;

  if (fields.labels !== undefined) {
    await client.put(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
      fields: { labels: fields.labels },
    });
    updated.push("labels");
  }

  if (fields.comment !== undefined && fields.comment.trim()) {
    await client.post(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
      body: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: fields.comment }],
          },
        ],
      },
    });
    updated.push("comment");
  }

  if (fields.status !== undefined && fields.status.trim()) {
    const transitions = await client.get<{
      transitions: Array<{ id: string; name: string; to: { name: string } }>;
    }>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`);
    const target = fields.status.trim().toLowerCase();
    const match = transitions.transitions.find(
      (t) =>
        t.name.toLowerCase() === target ||
        t.to.name.toLowerCase() === target,
    );
    if (!match) {
      throw new Error(
        `No Jira transition found matching status "${fields.status}" for ${issueKey}`,
      );
    }
    await client.post(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
      transition: { id: match.id },
    });
    updated.push("status");
  }

  return { issueKey, updated };
}
