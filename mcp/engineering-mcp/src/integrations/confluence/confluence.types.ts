/**
 * Partial Confluence Cloud REST API shapes and compact domain models.
 */

export interface ConfluenceSpaceApi {
  id?: string | number;
  key: string;
  name?: string;
  type?: string;
  status?: string;
  description?: {
    plain?: { value?: string };
  };
  _links?: { webui?: string; base?: string };
}

export interface ConfluenceContentApi {
  id: string;
  type?: string;
  status?: string;
  title?: string;
  space?: { key?: string; name?: string };
  body?: {
    storage?: { value?: string; representation?: string };
    view?: { value?: string; representation?: string };
  };
  version?: { number?: number; when?: string };
  history?: {
    createdDate?: string;
    lastUpdated?: { when?: string };
  };
  ancestors?: Array<{ id?: string; title?: string; _links?: { webui?: string } }>;
  excerpt?: string;
  _links?: { webui?: string; base?: string; self?: string };
}

export interface ConfluenceSearchResultApi {
  content?: ConfluenceContentApi;
  title?: string;
  excerpt?: string;
  url?: string;
  lastModified?: string;
  entityType?: string;
}

export interface ConfluenceSearchResponse {
  results?: ConfluenceSearchResultApi[];
  size?: number;
  totalSize?: number;
  start?: number;
  limit?: number;
  cqlQuery?: string;
}

export interface ConfluenceContentListResponse {
  results?: ConfluenceContentApi[];
  size?: number;
  start?: number;
  limit?: number;
}

export interface ConfluenceLabelApi {
  id?: string;
  name: string;
  prefix?: string;
}

export interface ConfluenceLabelsResponse {
  results?: ConfluenceLabelApi[];
  size?: number;
}

export interface CompactSpace {
  projectId: string;
  spaceKey: string;
  name: string;
  description?: string;
  type?: string;
  status?: string;
  url: string;
}

export interface CompactPageSummary {
  id: string;
  title: string;
  spaceKey: string;
  status?: string;
  url: string;
  excerpt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CompactPageDetail {
  projectId: string;
  id: string;
  title: string;
  spaceKey: string;
  status?: string;
  body: string;
  url: string;
  createdAt?: string;
  updatedAt?: string;
  version?: number;
  truncated: boolean;
}

export interface CompactPageChild {
  id: string;
  title: string;
  status?: string;
  url: string;
}

export interface CompactPageAncestor {
  id: string;
  title: string;
  url: string;
}

export interface CompactLabel {
  id?: string;
  name: string;
}
