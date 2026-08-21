import { JiraProjectBoundaryError, JiraValidationError } from "./jira.errors.js";

export interface ConstrainedJql {
  jql: string;
  allowedProjectKey: string;
}

/**
 * Detect project clauses in JQL and reject anything that conflicts with isolation.
 * Allowed:
 * - no project clause
 * - project = ALLOWED (or quoted)
 * Rejected:
 * - project = OTHER
 * - project in (...) with multiple or wrong keys
 * - project != ...
 * - project not in ...
 */
export function constrainJqlToProject(
  allowedProjectKey: string,
  userJql?: string,
): ConstrainedJql {
  const allowed = allowedProjectKey.trim();
  if (!allowed) {
    throw new JiraValidationError("Configured Jira project key is empty");
  }

  const trimmed = (userJql ?? "").trim();
  if (!trimmed) {
    return {
      jql: `project = "${escapeJqlString(allowed)}"`,
      allowedProjectKey: allowed,
    };
  }

  assertNoConflictingProjectClause(trimmed, allowed);

  return {
    jql: `project = "${escapeJqlString(allowed)}" AND (${trimmed})`,
    allowedProjectKey: allowed,
  };
}

export function assertNoConflictingProjectClause(
  jql: string,
  allowedProjectKey: string,
): void {
  const projectClausePattern =
    /\bproject\s*(!=|not\s+in|=|in)\s*(\([^)]*\)|"[^"]*"|'[^']*'|[A-Za-z][A-Za-z0-9_]*)/gi;

  let match: RegExpExecArray | null;
  while ((match = projectClausePattern.exec(jql)) !== null) {
    const operator = (match[1] ?? "").toLowerCase().replace(/\s+/g, " ");
    const operand = match[2] ?? "";

    if (operator === "!=" || operator === "not in") {
      throw new JiraProjectBoundaryError(
        `JQL project filter using "${operator}" is not allowed. ` +
          `Searches are constrained to project "${allowedProjectKey}".`,
      );
    }

    if (operator === "in") {
      const keys = parseProjectList(operand);
      if (keys.length !== 1 || !equalsIgnoreCase(keys[0] ?? "", allowedProjectKey)) {
        throw new JiraProjectBoundaryError(
          `JQL project filter must target only "${allowedProjectKey}". ` +
            `Received: project in ${operand}`,
        );
      }
      continue;
    }

    const key = parseSingleProjectKey(operand);
    if (!equalsIgnoreCase(key, allowedProjectKey)) {
      throw new JiraProjectBoundaryError(
        `JQL project filter "${key}" does not match configured project "${allowedProjectKey}".`,
      );
    }
  }
}

function parseProjectList(operand: string): string[] {
  const inner = operand.trim().replace(/^\(/, "").replace(/\)$/, "");
  if (!inner) {
    return [];
  }

  return inner
    .split(",")
    .map((part) => parseSingleProjectKey(part))
    .filter(Boolean);
}

function parseSingleProjectKey(operand: string): string {
  return operand.trim().replace(/^["']|["']$/g, "");
}

function equalsIgnoreCase(left: string, right: string): boolean {
  return left.toUpperCase() === right.toUpperCase();
}

function escapeJqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
