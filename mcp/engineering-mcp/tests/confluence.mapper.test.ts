import { describe, expect, it } from "vitest";
import {
  buildPageSearchCql,
  escapeCqlString,
} from "../src/integrations/confluence/confluence.cql.js";
import { ConfluenceValidationError } from "../src/integrations/confluence/confluence.errors.js";
import {
  mapPageDetail,
  mapSearchPage,
  mapSpace,
  storageOrHtmlToReadableText,
  truncateText,
} from "../src/integrations/confluence/confluence.mapper.js";

describe("Confluence CQL", () => {
  it("escapes quotes and backslashes", () => {
    expect(escapeCqlString(`a"b\\c`)).toBe(`a\\"b\\\\c`);
  });

  it("builds space-scoped CQL with escaped query", () => {
    const cql = buildPageSearchCql("KYGO", { query: `auth "login"` });
    expect(cql).toBe(`type = page AND space = "KYGO" AND text ~ "auth \\"login\\""`);
  });

  it("includes title filter when provided", () => {
    const cql = buildPageSearchCql("CLUBSYNC", { title: "API Spec" });
    expect(cql).toContain(`space = "CLUBSYNC"`);
    expect(cql).toContain(`title ~ "API Spec"`);
  });

  it("rejects invalid space keys", () => {
    expect(() => buildPageSearchCql("BAD KEY")).toThrow(ConfluenceValidationError);
  });
});

describe("ConfluenceMapper", () => {
  it("maps space compactly", () => {
    const space = mapSpace(
      "kygo",
      {
        key: "KYGO",
        name: "Kygo Docs",
        type: "global",
        status: "current",
        description: { plain: { value: " Engineering docs " } },
      },
      "https://example.atlassian.net",
    );
    expect(space).toMatchObject({
      projectId: "kygo",
      spaceKey: "KYGO",
      name: "Kygo Docs",
      description: "Engineering docs",
      type: "global",
      url: "https://example.atlassian.net/wiki/spaces/KYGO",
    });
  });

  it("converts storage HTML to readable text", () => {
    const html = `<h1>Auth</h1><p>Use <strong>OAuth</strong>.</p><ul><li>Step 1</li></ul>`;
    const text = storageOrHtmlToReadableText(html);
    expect(text).toContain("# Auth");
    expect(text).toContain("**OAuth**");
    expect(text).toContain("- Step 1");
    expect(text).not.toContain("<");
  });

  it("truncates with metadata marker", () => {
    const { text, truncated } = truncateText("abcdefghij", 5);
    expect(truncated).toBe(true);
    expect(text).toContain("…[truncated]");
  });

  it("maps page detail with truncation flag", () => {
    const page = mapPageDetail(
      "kygo",
      {
        id: "1",
        title: "Architecture",
        status: "current",
        space: { key: "KYGO" },
        body: { storage: { value: "<p>Hello</p>" } },
        version: { number: 3, when: "2026-01-01T00:00:00.000Z" },
        history: { createdDate: "2025-01-01T00:00:00.000Z" },
        _links: { webui: "/spaces/KYGO/pages/1" },
      },
      "https://example.atlassian.net",
      204_800,
    );
    expect(page.body).toContain("Hello");
    expect(page.truncated).toBe(false);
    expect(page.version).toBe(3);
    expect(page.url).toContain("/wiki/spaces/KYGO/pages/1");
  });

  it("maps search results without bodies", () => {
    const mapped = mapSearchPage(
      {
        excerpt: "<b>auth</b> excerpt",
        content: {
          id: "99",
          title: "Auth Guide",
          status: "current",
          type: "page",
          space: { key: "KYGO" },
          _links: { webui: "/spaces/KYGO/pages/99" },
        },
      },
      "https://example.atlassian.net",
      "KYGO",
    );
    expect(mapped).toMatchObject({
      id: "99",
      title: "Auth Guide",
      spaceKey: "KYGO",
    });
    expect(mapped?.excerpt).toContain("auth");
    expect(mapped).not.toHaveProperty("body");
  });
});
