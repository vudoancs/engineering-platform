import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { ZodError } from "zod";
import { ProjectConfigError, ProjectNotFoundError } from "./project-config.errors.js";
import {
  ProjectConfigSchema,
  type ProjectConfig,
} from "./project-config.schema.js";

export interface ProjectConfigLoaderOptions {
  /** Absolute or relative path to the projects/ directory. */
  projectsDir: string;
}

/**
 * Discovers, loads, and validates project YAML configuration files.
 *
 * Credentials must never appear in project YAML files.
 * This loader only reads routing metadata (Jira/GitHub/Confluence mappings).
 */
export class ProjectConfigLoader {
  private readonly projectsDir: string;

  constructor(options: ProjectConfigLoaderOptions) {
    this.projectsDir = path.resolve(options.projectsDir);
  }

  listProjectIds(): string[] {
    return this.discoverYamlFiles()
      .map((filePath) => path.basename(filePath, path.extname(filePath)))
      .sort((a, b) => a.localeCompare(b));
  }

  loadProject(projectId: string): ProjectConfig {
    const filePath = this.resolveProjectFile(projectId);

    if (!existsSync(filePath)) {
      throw new ProjectNotFoundError(projectId, filePath);
    }

    return this.loadAndValidateFile(filePath, { expectedId: projectId });
  }

  loadAllProjects(): ProjectConfig[] {
    const files = this.discoverYamlFiles();
    const configs: ProjectConfig[] = [];
    const seen = new Map<string, string>();

    for (const filePath of files) {
      const config = this.loadAndValidateFile(filePath);

      const existingFile = seen.get(config.id);
      if (existingFile !== undefined) {
        throw ProjectConfigError.invalid(
          config.id,
          filePath,
          "id",
          `Duplicate project ID "${config.id}" found in:\n- ${existingFile}\n- ${filePath}`,
        );
      }

      seen.set(config.id, filePath);
      configs.push(config);
    }

    return configs.sort((a, b) => a.id.localeCompare(b.id));
  }

  private discoverYamlFiles(): string[] {
    if (!existsSync(this.projectsDir)) {
      throw new ProjectConfigError(
        `Projects directory does not exist: ${this.projectsDir}`,
        {
          filePath: this.projectsDir,
          reason: "Projects directory not found",
        },
      );
    }

    const entries = readdirSync(this.projectsDir, { withFileTypes: true });

    return entries
      .filter((entry) => {
        if (!entry.isFile()) {
          return false;
        }

        const name = entry.name;
        if (name === "README.md") {
          return false;
        }

        const ext = path.extname(name).toLowerCase();
        return ext === ".yaml" || ext === ".yml";
      })
      .map((entry) => path.join(this.projectsDir, entry.name))
      .sort((a, b) => a.localeCompare(b));
  }

  private resolveProjectFile(projectId: string): string {
    const yamlPath = path.join(this.projectsDir, `${projectId}.yaml`);
    if (existsSync(yamlPath)) {
      return yamlPath;
    }

    const ymlPath = path.join(this.projectsDir, `${projectId}.yml`);
    if (existsSync(ymlPath)) {
      return ymlPath;
    }

    return yamlPath;
  }

  private loadAndValidateFile(
    filePath: string,
    options?: { expectedId?: string },
  ): ProjectConfig {
    let rawContents: string;

    try {
      rawContents = readFileSync(filePath, "utf8");
    } catch (error) {
      throw new ProjectConfigError(
        `Failed to read project configuration file: ${filePath}`,
        {
          filePath,
          reason: "Unable to read configuration file",
          cause: error,
        },
      );
    }

    let parsed: unknown;

    try {
      parsed = parseYaml(rawContents);
    } catch (error) {
      throw ProjectConfigError.invalid(
        options?.expectedId,
        filePath,
        undefined,
        `Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (parsed === null || parsed === undefined || typeof parsed !== "object") {
      throw ProjectConfigError.invalid(
        options?.expectedId,
        filePath,
        undefined,
        "Configuration must be a YAML object",
      );
    }

    const projectIdHint = this.readIdHint(parsed) ?? options?.expectedId;
    const result = ProjectConfigSchema.safeParse(parsed);

    if (!result.success) {
      throw this.toValidationError(result.error, filePath, projectIdHint);
    }

    const config = result.data;

    if (options?.expectedId !== undefined && config.id !== options.expectedId) {
      throw ProjectConfigError.invalid(
        config.id,
        filePath,
        "id",
        `Configuration id "${config.id}" does not match requested project ID "${options.expectedId}"`,
      );
    }

    return config;
  }

  private readIdHint(parsed: object): string | undefined {
    if (!("id" in parsed)) {
      return undefined;
    }

    const id = Reflect.get(parsed, "id");
    return typeof id === "string" ? id : undefined;
  }

  private toValidationError(
    error: ZodError,
    filePath: string,
    projectId?: string,
  ): ProjectConfigError {
    const issue = error.issues[0];
    const field =
      issue && issue.path.length > 0 ? issue.path.map(String).join(".") : undefined;
    const reason = issue?.message ?? "Configuration validation failed";

    return ProjectConfigError.invalid(projectId, filePath, field, reason);
  }
}
