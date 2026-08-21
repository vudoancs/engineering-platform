/**
 * Typed errors for the project configuration layer.
 */

export class ProjectConfigError extends Error {
  readonly projectId?: string;
  readonly filePath?: string;
  readonly field?: string;
  readonly reason?: string;

  constructor(
    message: string,
    options?: {
      projectId?: string;
      filePath?: string;
      field?: string;
      reason?: string;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ProjectConfigError";
    if (options?.projectId !== undefined) {
      this.projectId = options.projectId;
    }
    if (options?.filePath !== undefined) {
      this.filePath = options.filePath;
    }
    if (options?.field !== undefined) {
      this.field = options.field;
    }
    if (options?.reason !== undefined) {
      this.reason = options.reason;
    }
  }

  static invalid(
    projectId: string | undefined,
    filePath: string | undefined,
    field: string | undefined,
    reason: string,
  ): ProjectConfigError {
    const lines = [
      projectId
        ? `Invalid project configuration for "${projectId}":`
        : "Invalid project configuration:",
    ];

    if (filePath) {
      lines.push(filePath);
    }

    if (field) {
      lines.push("", "Field:", field);
    }

    lines.push("", "Reason:", reason);

    return new ProjectConfigError(lines.join("\n"), {
      ...(projectId !== undefined ? { projectId } : {}),
      ...(filePath !== undefined ? { filePath } : {}),
      ...(field !== undefined ? { field } : {}),
      reason,
    });
  }
}

export class ProjectNotFoundError extends ProjectConfigError {
  constructor(projectId: string, searchedPath?: string) {
    const lines = [`Project not found: "${projectId}"`];

    if (searchedPath) {
      lines.push(`Expected configuration file: ${searchedPath}`);
    }

    super(lines.join("\n"), {
      projectId,
      ...(searchedPath !== undefined ? { filePath: searchedPath } : {}),
      reason: "Project configuration file does not exist",
    });
    this.name = "ProjectNotFoundError";
  }
}

export class ProjectConfigMissingError extends ProjectConfigError {
  constructor(projectId: string, integration: "jira" | "github" | "confluence") {
    super(
      `Project "${projectId}" does not define ${integration} configuration.`,
      {
        projectId,
        field: integration,
        reason: `Missing ${integration} configuration`,
      },
    );
    this.name = "ProjectConfigMissingError";
  }
}
