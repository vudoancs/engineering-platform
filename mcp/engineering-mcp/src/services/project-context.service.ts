import {
  ProjectConfigLoader,
  ProjectConfigService,
  ProjectNotFoundError,
  type ProjectConfig,
} from "engineering-platform/config";
import { McpProjectNotFoundError } from "../errors/mcp-errors.js";

export interface ProjectContext {
  projectId: string;
}

export interface ProjectContextServiceOptions {
  projectConfigService: ProjectConfigService;
}

/**
 * Project-aware resolution without project-specific conditionals.
 * Reuses the platform ProjectConfigService — does not duplicate config logic.
 */
export class ProjectContextService {
  private readonly projectConfigService: ProjectConfigService;

  constructor(options: ProjectContextServiceOptions) {
    this.projectConfigService = options.projectConfigService;
  }

  static createDefault(projectsDir: string): ProjectContextService {
    const loader = new ProjectConfigLoader({ projectsDir });
    const projectConfigService = new ProjectConfigService({ loader });
    return new ProjectContextService({ projectConfigService });
  }

  createContext(projectId: string): ProjectContext {
    return { projectId };
  }

  resolveProject(projectId: string): ProjectConfig {
    try {
      return this.projectConfigService.getProject(projectId);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new McpProjectNotFoundError(projectId, { cause: error });
      }
      throw error;
    }
  }

  isProjectEnabled(projectId: string): boolean {
    try {
      return this.projectConfigService.isProjectEnabled(projectId);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new McpProjectNotFoundError(projectId, { cause: error });
      }
      throw error;
    }
  }

  getProjectConfigService(): ProjectConfigService {
    return this.projectConfigService;
  }
}
