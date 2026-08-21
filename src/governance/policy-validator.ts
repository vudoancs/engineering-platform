import { z } from "zod";
import { GovernanceConfigurationError } from "./governance.errors.js";
import type {
  ApprovalRulesPolicy,
  GovernanceConfig,
  PermissionsPolicy,
} from "./policy.types.js";

const DecisionSchema = z.enum(["ALLOW", "HUMAN_APPROVAL", "DENY"]);
const RiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

const ActionPolicySchema = z.object({
  decision: DecisionSchema,
  riskLevel: RiskLevelSchema,
  reason: z.string().min(1).optional(),
});

export const PermissionsPolicySchema = z.object({
  actions: z.record(z.string().min(1), ActionPolicySchema),
});

const ApprovalRequirementSchema = z.object({
  required: z.boolean(),
  minimumApprovers: z.number().int().min(1).max(20),
});

const ApprovalRuleSchema = z.object({
  action: z.string().min(1),
  require: z.array(z.string().min(1)).optional(),
  approval: ApprovalRequirementSchema,
});

export const ApprovalRulesPolicySchema = z.object({
  rules: z.array(ApprovalRuleSchema),
});

const ProjectSettingsSchema = z.object({
  allowWrite: z.boolean(),
});

export const GovernanceConfigSchema = z.object({
  version: z.number().int().positive(),
  defaults: z.object({
    unknownAction: DecisionSchema,
    missingPolicy: DecisionSchema,
    failClosed: z.boolean(),
  }),
  security: z.object({
    readOnlyByDefault: z.boolean(),
  }),
  approval: z.object({
    enabled: z.boolean(),
  }),
  projects: z.record(z.string().min(1), ProjectSettingsSchema),
});

export function validatePermissionsPolicy(raw: unknown): PermissionsPolicy {
  const result = PermissionsPolicySchema.safeParse(raw);
  if (!result.success) {
    throw new GovernanceConfigurationError(
      `Invalid permissions.yaml: ${formatZod(result.error)}`,
      { details: { file: "permissions.yaml" } },
    );
  }
  if (Object.keys(result.data.actions).length === 0) {
    throw new GovernanceConfigurationError(
      "Invalid permissions.yaml: actions must not be empty",
      { details: { file: "permissions.yaml" } },
    );
  }
  return result.data;
}

export function validateApprovalRulesPolicy(raw: unknown): ApprovalRulesPolicy {
  const result = ApprovalRulesPolicySchema.safeParse(raw);
  if (!result.success) {
    throw new GovernanceConfigurationError(
      `Invalid approval-rules.yaml: ${formatZod(result.error)}`,
      { details: { file: "approval-rules.yaml" } },
    );
  }
  return result.data;
}

export function validateGovernanceConfig(raw: unknown): GovernanceConfig {
  const result = GovernanceConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new GovernanceConfigurationError(
      `Invalid governance.yaml: ${formatZod(result.error)}`,
      { details: { file: "governance.yaml" } },
    );
  }

  if (
    result.data.defaults.failClosed &&
    (result.data.defaults.unknownAction !== "DENY" ||
      result.data.defaults.missingPolicy !== "DENY")
  ) {
    throw new GovernanceConfigurationError(
      "Invalid governance.yaml: failClosed=true requires unknownAction and missingPolicy to be DENY",
      { details: { file: "governance.yaml" } },
    );
  }

  if (!result.data.projects.default) {
    throw new GovernanceConfigurationError(
      'Invalid governance.yaml: projects.default is required',
      { details: { file: "governance.yaml" } },
    );
  }

  return result.data;
}

function formatZod(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return "validation failed";
  }
  const path = issue.path.map(String).join(".") || "(root)";
  return `${path}: ${issue.message}`;
}
