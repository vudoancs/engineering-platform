import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { WorkflowConfigurationError } from "./workflow-errors.js";
import { validateWorkflowYaml } from "./workflow-validator.js";
import type { WorkflowDefinition } from "./workflow.types.js";

export interface WorkflowLoaderOptions {
  workflowsDir: string;
  knownAgentIds: ReadonlySet<string> | readonly string[];
}

/**
 * Loads workflows/<id>/workflow.yaml. Invalid workflows fail immediately.
 * Placeholder folders without workflow.yaml are skipped.
 */
export class WorkflowLoader {
  private readonly workflowsDir: string;
  private readonly knownAgentIds: ReadonlySet<string>;

  constructor(options: WorkflowLoaderOptions) {
    this.workflowsDir = path.resolve(options.workflowsDir);
    this.knownAgentIds =
      options.knownAgentIds instanceof Set
        ? options.knownAgentIds
        : new Set(options.knownAgentIds);
  }

  loadAll(): WorkflowDefinition[] {
    if (!fs.existsSync(this.workflowsDir)) {
      throw new WorkflowConfigurationError(
        `Workflows directory not found: ${this.workflowsDir}`,
      );
    }

    const dirs = fs
      .readdirSync(this.workflowsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();

    const workflows: WorkflowDefinition[] = [];
    for (const dirName of dirs) {
      const yamlPath = path.join(this.workflowsDir, dirName, "workflow.yaml");
      if (!fs.existsSync(yamlPath)) {
        continue;
      }
      workflows.push(this.loadOne(dirName));
    }

    if (workflows.length === 0) {
      throw new WorkflowConfigurationError(
        `No workflows with workflow.yaml found under ${this.workflowsDir}`,
      );
    }

    const ids = new Set<string>();
    for (const wf of workflows) {
      if (ids.has(wf.id)) {
        throw new WorkflowConfigurationError(`Duplicate workflow id "${wf.id}"`);
      }
      ids.add(wf.id);
    }

    return workflows;
  }

  loadOne(dirName: string): WorkflowDefinition {
    const dir = path.join(this.workflowsDir, dirName);
    const yamlPath = path.join(dir, "workflow.yaml");
    if (!fs.existsSync(yamlPath)) {
      throw new WorkflowConfigurationError(`Missing workflow.yaml in ${dir}`);
    }

    let raw: unknown;
    try {
      raw = parseYaml(fs.readFileSync(yamlPath, "utf8"));
    } catch (error) {
      throw new WorkflowConfigurationError(`Failed to parse workflow.yaml in ${dir}`, {
        cause: error,
      });
    }

    const validated = validateWorkflowYaml(raw, {
      knownAgentIds: this.knownAgentIds,
      expectedIdFromDir: dirName,
    });

    return {
      ...validated,
      sourceDir: dir,
    };
  }
}
