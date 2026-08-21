import type {
  CompactLabel,
  CompactPageAncestor,
  CompactPageChild,
  CompactPageDetail,
  CompactPageSummary,
  CompactSpace,
  ConfluenceContentApi,
  ConfluenceLabelApi,
  ConfluenceSearchResultApi,
  ConfluenceSpaceApi,
} from "./confluence.types.js";

/**
 * Convert Confluence storage/view HTML (or storage XHTML) into compact text/Markdown-like content.
 */
export function storageOrHtmlToReadableText(input: string): string {
  let text = input;

  // Remove script/style
  text = text.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");

  // Confluence macros: keep inner text where present
  text = text.replace(/<ac:plain-text-body[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/gi, "$1");
  text = text.replace(/<ac:parameter[^>]*>[\s\S]*?<\/ac:parameter>/gi, "");
  text = text.replace(/<\/?ac:[^>]+>/gi, "");
  text = text.replace(/<\/?ri:[^>]+>/gi, "");

  // Headings
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, inner) => {
    const hashes = "#".repeat(Number(level));
    return `\n${hashes} ${stripTags(inner).trim()}\n`;
  });

  // Lists
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => `- ${stripTags(inner).trim()}\n`);
  text = text.replace(/<\/?[uo]l[^>]*>/gi, "\n");

  // Paragraphs / breaks
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<p[^>]*>/gi, "");

  // Links
  text = text.replace(
    /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href, inner) => `[${stripTags(inner).trim()}](${href})`,
  );

  // Code / pre
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner) => `\n\`\`\`\n${stripTags(inner)}\n\`\`\`\n`);
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner) => `\`${stripTags(inner)}\``);

  // Strong / emphasis
  text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");

  // Tables → simple lines
  text = text.replace(/<\/tr>/gi, "\n");
  text = text.replace(/<\/t[dh]>/gi, " | ");
  text = text.replace(/<\/?t[rdh][^>]*>/gi, "");
  text = text.replace(/<\/?table[^>]*>/gi, "\n");

  text = stripTags(text);
  text = decodeBasicEntities(text);
  text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

export function truncateText(
  value: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.byteLength <= maxBytes) {
    return { text: value, truncated: false };
  }

  let end = maxBytes;
  while (end > 0) {
    const byte = encoded[end];
    if (byte === undefined || (byte & 0xc0) !== 0x80) {
      break;
    }
    end -= 1;
  }
  const sliced = encoded.subarray(0, end).toString("utf8");
  return {
    text: `${sliced}\n\n…[truncated]`,
    truncated: true,
  };
}

export function mapSpace(
  projectId: string,
  space: ConfluenceSpaceApi,
  siteBaseUrl: string,
): CompactSpace {
  const spaceKey = space.key;
  const description = space.description?.plain?.value?.trim();
  const result: CompactSpace = {
    projectId,
    spaceKey,
    name: space.name?.trim() || spaceKey,
    url: buildSpaceUrl(siteBaseUrl, spaceKey, space._links?.webui),
  };
  if (description) {
    result.description = description;
  }
  if (space.type) {
    result.type = space.type;
  }
  if (space.status) {
    result.status = space.status;
  }
  return result;
}

export function mapSearchPage(
  result: ConfluenceSearchResultApi,
  siteBaseUrl: string,
  fallbackSpaceKey: string,
): CompactPageSummary | null {
  const content = result.content;
  if (!content?.id) {
    return null;
  }
  if (content.type && content.type !== "page") {
    return null;
  }

  const spaceKey = content.space?.key ?? fallbackSpaceKey;
  const title = content.title ?? result.title ?? content.id;
  const excerptRaw = result.excerpt ?? content.excerpt;
  const excerpt = excerptRaw
    ? storageOrHtmlToReadableText(excerptRaw).slice(0, 500)
    : undefined;

  const summary: CompactPageSummary = {
    id: String(content.id),
    title,
    spaceKey,
    url: buildContentUrl(siteBaseUrl, content._links?.webui ?? result.url),
  };
  if (content.status) {
    summary.status = content.status;
  }
  if (excerpt) {
    summary.excerpt = excerpt;
  }
  const updated = content.version?.when ?? content.history?.lastUpdated?.when ?? result.lastModified;
  if (updated) {
    summary.updatedAt = updated;
  }
  if (content.history?.createdDate) {
    summary.createdAt = content.history.createdDate;
  }
  return summary;
}

export function mapPageDetail(
  projectId: string,
  page: ConfluenceContentApi,
  siteBaseUrl: string,
  maxBodyBytes: number,
): CompactPageDetail {
  const spaceKey = page.space?.key ?? "";
  const rawBody =
    page.body?.view?.value ?? page.body?.storage?.value ?? "";
  const readable = storageOrHtmlToReadableText(rawBody);
  const { text, truncated } = truncateText(readable, maxBodyBytes);

  const detail: CompactPageDetail = {
    projectId,
    id: String(page.id),
    title: page.title ?? String(page.id),
    spaceKey,
    body: text,
    url: buildContentUrl(siteBaseUrl, page._links?.webui),
    truncated,
  };
  if (page.status) {
    detail.status = page.status;
  }
  if (page.history?.createdDate) {
    detail.createdAt = page.history.createdDate;
  }
  const updated = page.version?.when ?? page.history?.lastUpdated?.when;
  if (updated) {
    detail.updatedAt = updated;
  }
  if (page.version?.number !== undefined) {
    detail.version = page.version.number;
  }
  return detail;
}

export function mapPageChild(
  page: ConfluenceContentApi,
  siteBaseUrl: string,
): CompactPageChild {
  const child: CompactPageChild = {
    id: String(page.id),
    title: page.title ?? String(page.id),
    url: buildContentUrl(siteBaseUrl, page._links?.webui),
  };
  if (page.status) {
    child.status = page.status;
  }
  return child;
}

export function mapPageAncestor(
  ancestor: { id?: string; title?: string; _links?: { webui?: string } },
  siteBaseUrl: string,
): CompactPageAncestor | null {
  if (!ancestor.id) {
    return null;
  }
  return {
    id: String(ancestor.id),
    title: ancestor.title ?? String(ancestor.id),
    url: buildContentUrl(siteBaseUrl, ancestor._links?.webui),
  };
}

export function mapLabel(label: ConfluenceLabelApi): CompactLabel {
  const mapped: CompactLabel = { name: label.name };
  if (label.id !== undefined) {
    mapped.id = String(label.id);
  }
  return mapped;
}

export function getContentSpaceKey(page: ConfluenceContentApi): string | undefined {
  return page.space?.key;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(Number.parseInt(h, 16)));
}

function buildSpaceUrl(siteBaseUrl: string, spaceKey: string, webui?: string): string {
  if (webui?.startsWith("http")) {
    return webui;
  }
  if (webui) {
    return joinUrl(siteBaseUrl, webui.startsWith("/wiki") ? webui : `/wiki${webui.startsWith("/") ? "" : "/"}${webui}`);
  }
  return joinUrl(siteBaseUrl, `/wiki/spaces/${encodeURIComponent(spaceKey)}`);
}

function buildContentUrl(siteBaseUrl: string, webuiOrUrl?: string): string {
  if (!webuiOrUrl) {
    return siteBaseUrl;
  }
  if (webuiOrUrl.startsWith("http")) {
    return webuiOrUrl;
  }
  const path = webuiOrUrl.startsWith("/wiki")
    ? webuiOrUrl
    : `/wiki${webuiOrUrl.startsWith("/") ? webuiOrUrl : `/${webuiOrUrl}`}`;
  return joinUrl(siteBaseUrl, path);
}

function joinUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}
