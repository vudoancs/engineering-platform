/**
 * Safe Confluence CQL construction for space-scoped page search.
 * Never concatenate untrusted input without escaping.
 */

import { ConfluenceValidationError } from "./confluence.errors.js";

const SPACE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Escape a value for use inside a double-quoted CQL string literal.
 */
export function escapeCqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function assertValidSpaceKey(spaceKey: string): string {
  const trimmed = spaceKey.trim();
  if (!SPACE_KEY_PATTERN.test(trimmed)) {
    throw new ConfluenceValidationError(
      `Invalid Confluence space key "${spaceKey}". Expected alphanumeric key.`,
    );
  }
  return trimmed;
}

export interface BuildPageSearchCqlOptions {
  query?: string;
  title?: string;
}

/**
 * Build CQL that is always constrained to the given space.
 * Callers must resolve spaceKey from ProjectConfigService — never from AI-supplied space filters.
 */
export function buildPageSearchCql(
  spaceKey: string,
  options: BuildPageSearchCqlOptions = {},
): string {
  const safeSpace = assertValidSpaceKey(spaceKey);
  const clauses = [`type = page`, `space = "${escapeCqlString(safeSpace)}"`];

  const title = options.title?.trim();
  if (title) {
    if (title.length > 500) {
      throw new ConfluenceValidationError("title filter is too long (max 500 characters)");
    }
    clauses.push(`title ~ "${escapeCqlString(title)}"`);
  }

  const query = options.query?.trim();
  if (query) {
    if (query.length > 1000) {
      throw new ConfluenceValidationError("query is too long (max 1000 characters)");
    }
    clauses.push(`text ~ "${escapeCqlString(query)}"`);
  }

  return clauses.join(" AND ");
}
