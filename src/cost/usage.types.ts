/**
 * Normalized AI usage events — no prompts, secrets, or credentials.
 */

export type AIProviderId = "openai" | "anthropic" | "google" | "other" | string;

export type AIUsageOperation =
  | "chat"
  | "completion"
  | "embedding"
  | "tool_call"
  | "other";

export interface AIUsageEvent {
  id: string;
  timestamp: string;
  requestId: string;
  projectId: string;
  memberId?: string;
  agentId?: string;
  workflowId?: string;
  workflowInstanceId?: string;
  provider: AIProviderId;
  model: string;
  operation: AIUsageOperation;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs?: number;
  success: boolean;
  estimatedCostUsd: number;
  /** Set when estimate was replaced by actual calculation. */
  actualCostUsd?: boolean;
}

export interface RecordUsageInput {
  requestId: string;
  projectId: string;
  memberId?: string;
  agentId?: string;
  workflowId?: string;
  workflowInstanceId?: string;
  provider: AIProviderId;
  model: string;
  operation?: AIUsageOperation;
  inputTokens: number;
  outputTokens: number;
  latencyMs?: number;
  success: boolean;
}
