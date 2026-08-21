import type { GovernanceAuditEntry } from "./policy.types.js";

/**
 * Audit abstraction — no database. Implementations must never log secrets.
 */
export interface AuditService {
  record(entry: GovernanceAuditEntry): void;
  list(): GovernanceAuditEntry[];
}

/**
 * In-memory audit sink for local / MCP runtime.
 */
export class InMemoryAuditService implements AuditService {
  private readonly entries: GovernanceAuditEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  record(entry: GovernanceAuditEntry): void {
    this.entries.push({
      timestamp: entry.timestamp,
      requestId: entry.requestId,
      projectId: entry.projectId,
      actor: entry.actor,
      action: entry.action,
      decision: entry.decision,
      riskLevel: entry.riskLevel,
      reason: entry.reason,
    });
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  list(): GovernanceAuditEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.length = 0;
  }
}
