import TurndownService from 'turndown';
import type { KbSyncProvider, RawDocument } from './kb-sync-provider.js';
import type { SettingsQueries } from '../db/settings-store.js';

const MAX_CONCURRENT = 4;

export class ConfluenceSyncProvider implements KbSyncProvider {
  readonly source = 'confluence';
  private settings: SettingsQueries;
  private turndown: TurndownService;

  constructor(settings: SettingsQueries) {
    this.settings = settings;
    this.turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    // Strip Confluence macros
    this.turndown.addRule('confluenceMacros', {
      filter: (node) => node.nodeName === 'AC:STRUCTURED-MACRO' ||
        (node as Element).tagName?.toLowerCase()?.startsWith('ac:'),
      replacement: (_content, node) => {
        const text = (node as Element).textContent?.trim();
        return text ? `\n${text}\n` : '';
      },
    });
  }

  isConfigured(): boolean {
    const spaceKeys = this.settings.get('kb_confluence_space_keys')?.trim();
    const siteUrl = this.settings.get('confluence_site_url')?.trim();
    const email = this.settings.get('jira_ob_email')?.trim();
    const token = this.settings.get('jira_ob_token')?.trim();
    return !!(spaceKeys && siteUrl && email && token);
  }

  private getAuth(): { baseUrl: string; email: string; token: string } {
    const siteUrl = this.settings.get('confluence_site_url')?.trim();
    const email = this.settings.get('jira_ob_email')?.trim();
    const token = this.settings.get('jira_ob_token')?.trim();
    if (!siteUrl || !email || !token) {
      throw new Error('Confluence sync needs confluence_site_url plus Jira (Global) email/token');
    }
    return { baseUrl: siteUrl.replace(/\/$/, ''), email, token };
  }

  private getSpaceKeys(): string[] {
    const raw = this.settings.get('kb_confluence_space_keys')?.trim() || '';
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }

  async *fetchDocuments(): AsyncIterable<RawDocument> {
    if (!this.isConfigured()) return;

    const auth = this.getAuth();
    const spaceKeys = this.getSpaceKeys();
    const headers = {
      'Authorization': 'Basic ' + Buffer.from(`${auth.email}:${auth.token}`).toString('base64'),
      'Accept': 'application/json',
    };

    console.log(`[kb-confluence] Starting sync — site: ${auth.baseUrl}, email: ${auth.email}, spaces: ${spaceKeys.join(',')}`);

    for (const spaceKey of spaceKeys) {
      try {
        // Resolve space ID via v2 API
        const spaceUrl = `${auth.baseUrl}/wiki/api/v2/spaces?keys=${spaceKey}`;
        console.log(`[kb-confluence] Resolving space ${spaceKey} via ${spaceUrl}`);
        const spaceRes = await fetch(spaceUrl, { headers });
        const spaceBody = await spaceRes.text();
        if (!spaceRes.ok) {
          console.warn(`[kb-confluence] Failed to resolve space ${spaceKey}: ${spaceRes.status} — ${spaceBody.slice(0, 300)}`);
          continue;
        }
        if (!spaceBody.trim()) {
          console.warn(`[kb-confluence] Empty response resolving space ${spaceKey} (status ${spaceRes.status}) — auth may have failed. Email: ${auth.email}`);
          continue;
        }
        let spaceData: { results: Array<{ id: string }> };
        try { spaceData = JSON.parse(spaceBody); } catch {
          console.warn(`[kb-confluence] Invalid JSON resolving space ${spaceKey}: ${spaceBody.slice(0, 200)}`);
          continue;
        }
        if (!spaceData.results?.length) {
          console.warn(`[kb-confluence] Space ${spaceKey} not found (API returned empty results)`);
          continue;
        }
        const spaceId = spaceData.results[0].id;
        console.log(`[kb-confluence] Space ${spaceKey} resolved to ID ${spaceId}`);

        // Paginate through all pages in the space
        let pageUrl: string | null = `${auth.baseUrl}/wiki/api/v2/pages?space-id=${spaceId}&body-format=storage&limit=50&status=current`;

        while (pageUrl) {
          const pageRes = await fetch(pageUrl, { headers });
          const pageBody = await pageRes.text();
          if (!pageRes.ok) {
            console.warn(`[kb-confluence] Page fetch failed: ${pageRes.status} — ${pageBody.slice(0, 300)}`);
            break;
          }
          if (!pageBody.trim()) {
            console.warn(`[kb-confluence] Empty response fetching pages — check auth`);
            break;
          }
          let pageData: {
            results: Array<{
              id: string;
              title: string;
              version: { number: number };
              body?: { storage?: { value: string } };
              _links?: { webui?: string };
            }>;
            _links?: { next?: string };
          };
          try { pageData = JSON.parse(pageBody); } catch {
            console.warn(`[kb-confluence] Invalid JSON fetching pages: ${pageBody.slice(0, 200)}`);
            break;
          }

          // Process pages with concurrency limit
          const pages = pageData.results || [];
          for (let i = 0; i < pages.length; i += MAX_CONCURRENT) {
            const batch = pages.slice(i, i + MAX_CONCURRENT);
            const docs = batch
              .filter(page => page.body?.storage?.value?.trim())
              .map(page => this.pageToDocument(page, spaceKey, auth.baseUrl));

            for (const doc of docs) {
              if (doc) yield doc;
            }
          }

          // Follow pagination cursor
          const nextLink = pageData._links?.next;
          pageUrl = nextLink ? `${auth.baseUrl}${nextLink}` : null;
        }
      } catch (err) {
        console.warn(`[kb-confluence] Error syncing space ${spaceKey}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  private pageToDocument(
    page: { id: string; title: string; version: { number: number }; body?: { storage?: { value: string } }; _links?: { webui?: string } },
    spaceKey: string,
    baseUrl: string
  ): RawDocument | null {
    try {
      const html = page.body?.storage?.value || '';
      if (!html.trim()) return null;

      const markdown = this.turndown.turndown(html);
      if (!markdown.trim()) return null;

      return {
        sourceDocId: `${page.id}:${page.version.number}`,
        path: `${spaceKey}/${page.title}`,
        title: page.title,
        url: `${baseUrl}/wiki/spaces/${spaceKey}/pages/${page.id}`,
        markdown,
      };
    } catch (err) {
      console.warn(`[kb-confluence] Failed to convert page ${page.id} "${page.title}":`, err instanceof Error ? err.message : err);
      return null;
    }
  }
}
