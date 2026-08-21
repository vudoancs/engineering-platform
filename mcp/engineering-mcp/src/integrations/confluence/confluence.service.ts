import {
  ProjectConfigMissingError,
  ProjectNotFoundError,
  type ProjectConfigService,
} from "engineering-platform/config";
import { McpProjectNotFoundError } from "../../errors/mcp-errors.js";
import { ConfluenceClient } from "./confluence.client.js";
import { buildPageSearchCql } from "./confluence.cql.js";
import {
  ConfluenceConfigurationError,
  ConfluenceProjectBoundaryError,
  ConfluenceValidationError,
} from "./confluence.errors.js";
import {
  getContentSpaceKey,
  mapLabel,
  mapPageAncestor,
  mapPageChild,
  mapPageDetail,
  mapSearchPage,
  mapSpace,
} from "./confluence.mapper.js";
import type {
  CompactLabel,
  CompactPageAncestor,
  CompactPageChild,
  CompactPageDetail,
  CompactPageSummary,
  CompactSpace,
  ConfluenceContentApi,
  ConfluenceContentListResponse,
  ConfluenceLabelsResponse,
  ConfluenceSearchResponse,
  ConfluenceSpaceApi,
} from "./confluence.types.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_MAX_PAGE_SIZE_BYTES = 200 * 1024;

export interface ConfluenceServiceOptions {
  projectConfigService: ProjectConfigService;
  client?: ConfluenceClient | null;
  maxPageSizeBytes?: number;
}

export interface SearchPagesOptions {
  query?: string;
  title?: string;
  limit?: number;
}

/**
 * Project-agnostic Confluence read operations.
 * Resolves space keys exclusively through ProjectConfigService.
 */
export class ConfluenceService {
  private readonly projectConfigService: ProjectConfigService;
  private readonly client: ConfluenceClient | null;
  private readonly maxPageSizeBytes: number;

  constructor(options: ConfluenceServiceOptions) {
    this.projectConfigService = options.projectConfigService;
    this.client = options.client ?? null;
    this.maxPageSizeBytes = options.maxPageSizeBytes ?? DEFAULT_MAX_PAGE_SIZE_BYTES;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async getSpace(projectId: string): Promise<CompactSpace> {
    const client = this.requireClient();
    const spaceKey = this.resolveSpaceKey(projectId);
    const space = await client.get<ConfluenceSpaceApi>(
      `/rest/api/space/${encodeURIComponent(spaceKey)}`,
      { expand: "description.plain" },
    );
    this.assertSpaceMatchesProject(projectId, spaceKey, space.key);
    return mapSpace(projectId, space, client.getSiteBaseUrl());
  }

  async searchPages(
    projectId: string,
    options: SearchPagesOptions = {},
  ): Promise<{
    projectId: string;
    total?: number;
    limit: number;
    pages: CompactPageSummary[];
  }> {
    const client = this.requireClient();
    const spaceKey = this.resolveSpaceKey(projectId);
    const limit = clampLimit(options.limit ?? DEFAULT_LIMIT);
    const cql = buildPageSearchCql(spaceKey, {
      ...(options.query !== undefined ? { query: options.query } : {}),
      ...(options.title !== undefined ? { title: options.title } : {}),
    });

    const response = await client.get<ConfluenceSearchResponse>("/rest/api/content/search", {
      cql,
      limit,
      expand: "content.space,content.history,content.version",
    });

    const pages: CompactPageSummary[] = [];
    for (const item of response.results ?? []) {
      const mapped = mapSearchPage(item, client.getSiteBaseUrl(), spaceKey);
      if (!mapped) {
        continue;
      }
      if (mapped.spaceKey.toUpperCase() !== spaceKey.toUpperCase()) {
        throw new ConfluenceProjectBoundaryError(
          `Space ${mapped.spaceKey} is not configured for project ${projectId}.`,
          {
            details: {
              projectId,
              configuredSpaceKey: spaceKey,
              attemptedSpaceKey: mapped.spaceKey,
            },
          },
        );
      }
      pages.push(mapped);
    }

    const result: {
      projectId: string;
      total?: number;
      limit: number;
      pages: CompactPageSummary[];
    } = {
      projectId,
      limit,
      pages,
    };
    if (response.totalSize !== undefined) {
      result.total = response.totalSize;
    }
    return result;
  }

  async getPage(projectId: string, pageId: string): Promise<CompactPageDetail> {
    const client = this.requireClient();
    const spaceKey = this.resolveSpaceKey(projectId);
    const id = assertPageId(pageId);

    const page = await client.get<ConfluenceContentApi>(
      `/rest/api/content/${encodeURIComponent(id)}`,
      {
        expand: "body.storage,body.view,space,version,history",
      },
    );

    this.assertPageInSpace(projectId, spaceKey, page);
    return mapPageDetail(projectId, page, client.getSiteBaseUrl(), this.maxPageSizeBytes);
  }

  async getPageChildren(
    projectId: string,
    pageId: string,
    options: { limit?: number } = {},
  ): Promise<{ pageId: string; children: CompactPageChild[]; limit: number }> {
    const client = this.requireClient();
    const spaceKey = this.resolveSpaceKey(projectId);
    const id = assertPageId(pageId);
    const limit = clampLimit(options.limit ?? DEFAULT_LIMIT);

    await this.fetchAndAssertPageSpace(client, projectId, spaceKey, id);

    const response = await client.get<ConfluenceContentListResponse>(
      `/rest/api/content/${encodeURIComponent(id)}/child/page`,
      { limit, expand: "space" },
    );

    const children: CompactPageChild[] = [];
    for (const child of response.results ?? []) {
      const childSpace = getContentSpaceKey(child);
      if (childSpace && childSpace.toUpperCase() !== spaceKey.toUpperCase()) {
        throw new ConfluenceProjectBoundaryError(
          `Space ${childSpace} is not configured for project ${projectId}.`,
          {
            details: {
              projectId,
              configuredSpaceKey: spaceKey,
              attemptedSpaceKey: childSpace,
            },
          },
        );
      }
      children.push(mapPageChild(child, client.getSiteBaseUrl()));
    }

    return { pageId: id, children, limit };
  }

  async getPageAncestors(
    projectId: string,
    pageId: string,
  ): Promise<{ pageId: string; ancestors: CompactPageAncestor[] }> {
    const client = this.requireClient();
    const spaceKey = this.resolveSpaceKey(projectId);
    const id = assertPageId(pageId);

    const page = await client.get<ConfluenceContentApi>(
      `/rest/api/content/${encodeURIComponent(id)}`,
      { expand: "ancestors,space" },
    );
    this.assertPageInSpace(projectId, spaceKey, page);

    const ancestors: CompactPageAncestor[] = [];
    for (const ancestor of page.ancestors ?? []) {
      const mapped = mapPageAncestor(ancestor, client.getSiteBaseUrl());
      if (mapped) {
        ancestors.push(mapped);
      }
    }

    return { pageId: id, ancestors };
  }

  async getPageLabels(
    projectId: string,
    pageId: string,
  ): Promise<{ pageId: string; labels: CompactLabel[] }> {
    const client = this.requireClient();
    const spaceKey = this.resolveSpaceKey(projectId);
    const id = assertPageId(pageId);

    await this.fetchAndAssertPageSpace(client, projectId, spaceKey, id);

    const response = await client.get<ConfluenceLabelsResponse>(
      `/rest/api/content/${encodeURIComponent(id)}/label`,
    );

    return {
      pageId: id,
      labels: (response.results ?? []).map(mapLabel),
    };
  }

  /**
   * Explicit space access check for callers that receive a spaceKey (e.g. tests / future tools).
   */
  assertAllowedSpace(projectId: string, spaceKey: string): void {
    const configured = this.resolveSpaceKey(projectId);
    this.assertSpaceMatchesProject(projectId, configured, spaceKey);
  }

  private async fetchAndAssertPageSpace(
    client: ConfluenceClient,
    projectId: string,
    spaceKey: string,
    pageId: string,
  ): Promise<ConfluenceContentApi> {
    const page = await client.get<ConfluenceContentApi>(
      `/rest/api/content/${encodeURIComponent(pageId)}`,
      { expand: "space" },
    );
    this.assertPageInSpace(projectId, spaceKey, page);
    return page;
  }

  private assertPageInSpace(
    projectId: string,
    configuredSpaceKey: string,
    page: ConfluenceContentApi,
  ): void {
    const pageSpace = getContentSpaceKey(page);
    if (!pageSpace) {
      throw new ConfluenceValidationError(
        `Page ${page.id} did not include space metadata; cannot enforce project isolation.`,
        { details: { projectId, pageId: page.id } },
      );
    }
    this.assertSpaceMatchesProject(projectId, configuredSpaceKey, pageSpace);
  }

  private assertSpaceMatchesProject(
    projectId: string,
    configuredSpaceKey: string,
    attemptedSpaceKey: string,
  ): void {
    if (configuredSpaceKey.toUpperCase() !== attemptedSpaceKey.toUpperCase()) {
      throw new ConfluenceProjectBoundaryError(
        `Space ${attemptedSpaceKey} is not configured for project ${projectId}.`,
        {
          details: {
            projectId,
            configuredSpaceKey,
            attemptedSpaceKey,
          },
        },
      );
    }
  }

  private resolveSpaceKey(projectId: string): string {
    try {
      return this.projectConfigService.getConfluenceConfig(projectId).spaceKey;
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new McpProjectNotFoundError(projectId);
      }
      if (error instanceof ProjectConfigMissingError) {
        throw new ConfluenceConfigurationError(
          `Project "${projectId}" has no Confluence configuration.`,
          { details: { projectId, integration: "confluence" } },
        );
      }
      throw error;
    }
  }

  private requireClient(): ConfluenceClient {
    if (!this.client) {
      throw new ConfluenceConfigurationError(
        "Confluence credentials are not configured. Set CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, and CONFLUENCE_API_TOKEN.",
      );
    }
    return this.client;
  }
}

function clampLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new ConfluenceValidationError("limit must be a positive integer");
  }
  if (limit > MAX_LIMIT) {
    throw new ConfluenceValidationError(`limit must be <= ${MAX_LIMIT}`);
  }
  return limit;
}

function assertPageId(pageId: string): string {
  const trimmed = pageId.trim();
  if (!trimmed) {
    throw new ConfluenceValidationError("pageId is required");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new ConfluenceValidationError("pageId contains invalid characters");
  }
  return trimmed;
}

export function createConfluenceClientFromEnv(env: {
  CONFLUENCE_BASE_URL?: string;
  CONFLUENCE_EMAIL?: string;
  CONFLUENCE_API_TOKEN?: string;
  CONFLUENCE_REQUEST_TIMEOUT_MS?: number;
}): ConfluenceClient | null {
  const baseUrl = env.CONFLUENCE_BASE_URL?.trim();
  const email = env.CONFLUENCE_EMAIL?.trim();
  const apiToken = env.CONFLUENCE_API_TOKEN?.trim();
  if (!baseUrl || !email || !apiToken) {
    return null;
  }

  return new ConfluenceClient({
    baseUrl,
    email,
    apiToken,
    timeoutMs: env.CONFLUENCE_REQUEST_TIMEOUT_MS ?? 10_000,
  });
}
