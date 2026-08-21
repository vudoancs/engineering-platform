import { z } from "zod";
import { WORKFLOW_ACTIONS } from "./action-executor.js";
import { WorkflowValidationError } from "./workflow-errors.js";
import {
  PREDEFINED_CONDITIONS,
  STEP_TYPES,
  type StepApprovalConfig,
  type WorkflowDefinition,
  type WorkflowStep,
} from "./workflow.types.js";

const ApprovalSchema = z.object({
  required: z.boolean(),
  minimumApprovers: z.number().int().min(1),
  reason: z.string().optional(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
});

const StepSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .regex(/^[a-z][a-z0-9-]*$/, "step id must be kebab-case"),
    type: z.enum(STEP_TYPES),
    agent: z.string().trim().min(1).optional(),
    action: z.string().trim().min(1).optional(),
    condition: z.enum(PREDEFINED_CONDITIONS).optional(),
    dependsOn: z.array(z.string().trim().min(1)).optional(),
    approval: ApprovalSchema.optional(),
    onSuccess: z.string().trim().min(1).optional(),
    onFailure: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    retry: z
      .object({
        maxAttempts: z.number().int().min(1).max(5),
      })
      .optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .superRefine((step, ctx) => {
    if (step.type === "AGENT" && !step.agent) {
      ctx.addIssue({ code: "custom", message: "AGENT steps require agent", path: ["agent"] });
    }
    if (step.type === "ACTION" && !step.action) {
      ctx.addIssue({ code: "custom", message: "ACTION steps require action", path: ["action"] });
    }
    if (step.type === "CONDITION" && !step.condition) {
      ctx.addIssue({
        code: "custom",
        message: "CONDITION steps require condition",
        path: ["condition"],
      });
    }
    if (step.type === "APPROVAL") {
      if (!step.approval) {
        ctx.addIssue({
          code: "custom",
          message: "APPROVAL steps require approval config",
          path: ["approval"],
        });
      } else if (!step.approval.required) {
        ctx.addIssue({
          code: "custom",
          message: "APPROVAL steps must have approval.required=true",
          path: ["approval", "required"],
        });
      }
    }
  });

export const WorkflowYamlSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, "id must be kebab-case"),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  version: z.number().int().positive(),
  trigger: z.object({ type: z.literal("manual") }),
  steps: z.array(StepSchema).min(1),
});

export interface ValidateWorkflowOptions {
  knownAgentIds: ReadonlySet<string>;
  expectedIdFromDir?: string;
}

export function validateWorkflowYaml(
  raw: unknown,
  options: ValidateWorkflowOptions,
): Omit<WorkflowDefinition, "sourceDir"> {
  const parsed = WorkflowYamlSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.map(String).join(".") || "(root)";
    throw new WorkflowValidationError(
      `Invalid workflow.yaml: ${path}: ${issue?.message ?? "validation failed"}`,
    );
  }

  const data = parsed.data;
  if (options.expectedIdFromDir && options.expectedIdFromDir !== data.id) {
    throw new WorkflowValidationError(
      `Workflow id "${data.id}" does not match directory "${options.expectedIdFromDir}"`,
    );
  }

  const stepIds = new Set<string>();
  for (const step of data.steps) {
    if (stepIds.has(step.id)) {
      throw new WorkflowValidationError(`Duplicate step id "${step.id}"`);
    }
    stepIds.add(step.id);
  }

  for (const step of data.steps) {
    validateStepSemantics(step, options.knownAgentIds, stepIds);
  }

  detectCircularDependencies(
    data.steps.map((s) => ({
      id: s.id,
      ...(s.dependsOn !== undefined ? { dependsOn: s.dependsOn } : {}),
    })),
  );

  return {
    id: data.id,
    name: data.name,
    description: data.description,
    version: data.version,
    trigger: data.trigger,
    steps: data.steps.map(normalizeStep),
  };
}

function normalizeStep(step: z.infer<typeof StepSchema>): WorkflowStep {
  const normalized: WorkflowStep = {
    id: step.id,
    type: step.type,
    enabled: step.enabled ?? true,
  };
  if (step.agent !== undefined) normalized.agent = step.agent;
  if (step.action !== undefined) normalized.action = step.action;
  if (step.condition !== undefined) normalized.condition = step.condition;
  if (step.dependsOn !== undefined) normalized.dependsOn = [...step.dependsOn];
  if (step.approval !== undefined) {
    const approval: StepApprovalConfig = {
      required: step.approval.required,
      minimumApprovers: step.approval.minimumApprovers,
    };
    if (step.approval.reason !== undefined) approval.reason = step.approval.reason;
    if (step.approval.riskLevel !== undefined) approval.riskLevel = step.approval.riskLevel;
    normalized.approval = approval;
  }
  if (step.onSuccess !== undefined) normalized.onSuccess = step.onSuccess;
  if (step.onFailure !== undefined) normalized.onFailure = step.onFailure;
  if (step.retry !== undefined) normalized.retry = { ...step.retry };
  if (step.timeoutMs !== undefined) normalized.timeoutMs = step.timeoutMs;
  return normalized;
}

function validateStepSemantics(
  step: z.infer<typeof StepSchema>,
  knownAgentIds: ReadonlySet<string>,
  stepIds: Set<string>,
): void {
  if (step.type === "AGENT" && step.agent && !knownAgentIds.has(step.agent)) {
    throw new WorkflowValidationError(
      `Step "${step.id}" references unknown agent "${step.agent}"`,
    );
  }
  if (step.type === "ACTION" && step.action && !(step.action in WORKFLOW_ACTIONS)) {
    throw new WorkflowValidationError(
      `Step "${step.id}" references unknown action "${step.action}"`,
    );
  }
  for (const dep of step.dependsOn ?? []) {
    if (!stepIds.has(dep)) {
      throw new WorkflowValidationError(
        `Step "${step.id}" dependsOn unknown step "${dep}"`,
      );
    }
    if (dep === step.id) {
      throw new WorkflowValidationError(`Step "${step.id}" cannot depend on itself`);
    }
  }
  if (step.onSuccess && !stepIds.has(step.onSuccess)) {
    throw new WorkflowValidationError(
      `Step "${step.id}" onSuccess references unknown step "${step.onSuccess}"`,
    );
  }
  if (step.onFailure && !stepIds.has(step.onFailure)) {
    throw new WorkflowValidationError(
      `Step "${step.id}" onFailure references unknown step "${step.onFailure}"`,
    );
  }
}

function detectCircularDependencies(steps: Array<{ id: string; dependsOn?: string[] }>): void {
  const graph = new Map<string, string[]>();
  for (const step of steps) {
    graph.set(step.id, [...(step.dependsOn ?? [])]);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(node: string, path: string[]): void {
    if (visiting.has(node)) {
      throw new WorkflowValidationError(
        `Circular dependency detected: ${[...path, node].join(" -> ")}`,
      );
    }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const next of graph.get(node) ?? []) {
      dfs(next, [...path, node]);
    }
    visiting.delete(node);
    visited.add(node);
  }

  for (const id of graph.keys()) {
    dfs(id, []);
  }
}
