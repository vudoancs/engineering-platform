export type PermissionAction = "READ" | "WRITE" | "DELETE" | "EXECUTE";

export interface PermissionDecision {
  allowed: boolean;
  requiresHumanApproval: boolean;
  reason: string;
}

export interface PermissionServiceOptions {
  readOnly: boolean;
}
