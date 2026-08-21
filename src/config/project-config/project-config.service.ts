import { ProjectConfigMissingError } from "./project-config.errors.js";
import { ProjectConfigLoader } from "./project-config.loader.js";
import type {
  ConfluenceConfig,
  GithubConfig,
  JiraConfig,
  ProjectConfig,
} from "./project-config.schema.js";

export interface ProjectConfigServiceOptions {
  loader: ProjectConfigLoader;
}

/**
 * Project-agnostic configuration resolution for platform integrations.
 *
 * Future MCP tools, agents, and workflows resolve Jira/GitHub/Confluence
 * routing metadata through this service using only a projectId.
 */
export class ProjectConfigService {
  private readonly loader: ProjectConfigLoader;

  constructor(options: ProjectConfigServiceOptions) {
    this.loader = options.loader;
  }

  getProject(projectId: string): ProjectConfig {
    return this.loader.loadProject(projectId);
  }

  getJiraConfig(projectId: string): JiraConfig {
    const project = this.getProject(projectId);

    if (!project.jira) {
      throw new ProjectConfigMissingError(projectId, "jira");
    }

    return project.jira;
  }

  getGithubConfig(projectId: string): GithubConfig {
    const project = this.getProject(projectId);

    if (!project.github) {
      throw new ProjectConfigMissingError(projectId, "github");
    }

    return project.github;
  }

  getConfluenceConfig(projectId: string): ConfluenceConfig {
    const project = this.getProject(projectId);

    if (!project.confluence) {
      throw new ProjectConfigMissingError(projectId, "confluence");
    }

    return project.confluence;
  }

  isProjectEnabled(projectId: string): boolean {
    const project = this.getProject(projectId);
    return project.settings.enabled;
  }

  listProjects(): ProjectConfig[] {
    return this.loader.loadAllProjects();
  }
}