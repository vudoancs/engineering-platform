/**
 * Confluence write surface — intentionally not registered as MCP tools.
 * confluence.update_page remains DISABLED in the execution action registry.
 */

export interface ConfluenceWritePort {
  updatePage(_input: {
    projectId: string;
    pageId: string;
    title: string;
    bodyStorage: string;
  }): Promise<never>;
}

export class DisabledConfluenceWrite implements ConfluenceWritePort {
  async updatePage(): Promise<never> {
    throw new Error(
      "confluence.update_page is disabled by engineering policy and is not exposed via MCP",
    );
  }
}
