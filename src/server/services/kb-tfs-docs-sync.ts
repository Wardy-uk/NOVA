import type { KbSyncProvider, RawDocument } from './kb-sync-provider.js';
import type { SettingsQueries } from '../db/settings-store.js';

export class TfsDocsSyncProvider implements KbSyncProvider {
  readonly source = 'tfs-docs';
  private settings: SettingsQueries;
  public lastDiagnostics: string[] = [];

  constructor(settings: SettingsQueries) {
    this.settings = settings;
  }

  isConfigured(): boolean {
    return !!this.settings.get('tfs_docs_pat')?.trim();
  }

  private getHeaders(): Record<string, string> {
    const pat = this.settings.get('tfs_docs_pat')?.trim();
    if (!pat) throw new Error('tfs_docs_pat not configured');
    return {
      'Authorization': 'Basic ' + Buffer.from(`:${pat}`).toString('base64'),
      'Accept': 'application/json',
    };
  }

  private getRepoBaseUrl(): string {
    const repoUrl = this.settings.get('tfs_docs_repo_url')?.trim()
      || 'https://tfs.briefyourmarket.com/BYM2020/Core/_git/nurtur-docs';
    return repoUrl.replace('/_git/', '/_apis/git/repositories/');
  }

  private getBranch(): string {
    return this.settings.get('tfs_docs_branch')?.trim() || 'main';
  }

  async *fetchDocuments(): AsyncIterable<RawDocument> {
    if (!this.isConfigured()) return;
    this.lastDiagnostics = [];

    const headers = this.getHeaders();
    const apiBase = this.getRepoBaseUrl();
    const branch = this.getBranch();
    const repoUrl = this.settings.get('tfs_docs_repo_url')?.trim()
      || 'https://tfs.briefyourmarket.com/BYM2020/Core/_git/nurtur-docs';

    const listUrl = `${apiBase}/items?recursionLevel=full&versionDescriptor.version=${branch}&api-version=7.0`;
    this.diag(`[kb-tfs] Listing files from ${apiBase} (branch: ${branch})`);

    const listRes = await fetch(listUrl, { headers });
    if (!listRes.ok) {
      const body = await listRes.text();
      throw new Error(`TFS item list failed: ${listRes.status} — ${body.slice(0, 300)}`);
    }

    const listData = await listRes.json();
    const items = (listData.value || []).filter(
      (item: any) => !item.isFolder && item.path.endsWith('.md')
    );
    this.diag(`[kb-tfs] Found ${items.length} markdown files`);

    let processed = 0;
    let skipped = 0;

    for (const item of items) {
      try {
        const contentUrl = `${apiBase}/items?path=${encodeURIComponent(item.path)}&versionDescriptor.version=${branch}&api-version=7.0&$format=text`;
        const contentRes = await fetch(contentUrl, {
          headers: { ...headers, 'Accept': 'text/plain' },
        });
        if (!contentRes.ok) {
          this.diag(`[kb-tfs] Failed to fetch ${item.path}: ${contentRes.status}`);
          skipped++;
          continue;
        }

        const content = await contentRes.text();
        if (!content.trim()) {
          skipped++;
          continue;
        }

        const title = this.extractTitle(content, item.path);
        const relativePath = item.path.replace(/^\//, '');

        yield {
          sourceDocId: item.objectId || item.commitId || relativePath,
          path: relativePath,
          title,
          url: `${repoUrl}?path=${encodeURIComponent(item.path)}`,
          markdown: content,
        };
        processed++;
      } catch (err) {
        this.diag(`[kb-tfs] Error processing ${item.path}: ${err instanceof Error ? err.message : err}`);
        skipped++;
      }
    }

    this.diag(`[kb-tfs] Complete: ${processed} docs processed, ${skipped} skipped`);
  }

  private extractTitle(content: string, filename: string): string {
    const h1Match = content.match(/^#\s+(.+)/m);
    if (h1Match) return h1Match[1].trim();
    return filename.split('/').pop()?.replace('.md', '') || filename;
  }

  private diag(msg: string) {
    console.log(msg);
    this.lastDiagnostics.push(msg);
  }
}
