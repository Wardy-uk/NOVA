import type { KbSyncProvider, RawDocument } from './kb-sync-provider.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { resolveConfluenceAuth, confluenceSiteUrl, type ConfluenceAuth } from './confluence-auth.js';

const MAX_CONCURRENT = 4;

export class ConfluenceSyncProvider implements KbSyncProvider {
  readonly source = 'confluence';
  private settings: SettingsQueries;
  public lastDiagnostics: string[] = [];

  constructor(settings: SettingsQueries) {
    this.settings = settings;
  }

  // A credential is NOT required: the public Service Hub (NT) answers anonymously,
  // so all this needs is somewhere to sync from and something to sync.
  isConfigured(): boolean {
    return !!this.settings.get('kb_confluence_space_keys')?.trim() && !!confluenceSiteUrl(this.settings);
  }

  /** Credentials to try per space, best first, ending with anonymous. Reading a
   *  public space needs no identity, so a dead service-account token must not be
   *  the thing that leaves the KB empty. */
  private getCandidates(): Array<{ headers: Record<string, string>; label: string }> {
    const out: Array<{ headers: Record<string, string>; label: string }> = [];
    try {
      const auth: ConfluenceAuth = resolveConfluenceAuth(this.settings);
      out.push({ headers: auth.headers, label: auth.label });
    } catch {
      // No credential configured at all — anonymous is the only option, which is fine.
    }
    out.push({ headers: { Accept: 'application/json' }, label: 'anonymous (public space)' });
    return out;
  }

  private getSpaceKeys(): string[] {
    const raw = this.settings.get('kb_confluence_space_keys')?.trim() || '';
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }

  private diag(msg: string) {
    console.warn(msg);
    this.lastDiagnostics.push(msg);
  }

  async *fetchDocuments(): AsyncIterable<RawDocument> {
    if (!this.isConfigured()) return;
    this.lastDiagnostics = [];

    const baseUrl = confluenceSiteUrl(this.settings)!;
    const spaceKeys = this.getSpaceKeys();
    const candidates = this.getCandidates();

    this.diag(`[kb-confluence] Starting sync — site: ${baseUrl}, spaces: ${spaceKeys.join(',')}, trying: ${candidates.map(c => c.label).join(' then ')}`);

    for (const spaceKey of spaceKeys) {
      try {
        // Resolve the space, trying each credential in turn. A space that only
        // answers anonymously (the public Service Hub) still gets indexed, so a
        // dead service-account token can't be what leaves the KB empty.
        let spaceId: string | undefined;
        let headers: Record<string, string> | undefined;
        for (const cand of candidates) {
          const spaceRes = await fetch(`${baseUrl}/wiki/api/v2/spaces?keys=${spaceKey}`, { headers: cand.headers });
          const spaceBody = await spaceRes.text();
          if (!spaceRes.ok) {
            this.diag(`[kb-confluence] ${spaceKey}: HTTP ${spaceRes.status} as ${cand.label} — trying next credential`);
            continue;
          }
          if (!spaceBody.trim()) {
            this.diag(`[kb-confluence] ${spaceKey}: empty response as ${cand.label} — trying next credential`);
            continue;
          }
          let spaceData: { results?: Array<{ id: string }> };
          try { spaceData = JSON.parse(spaceBody); } catch {
            this.diag(`[kb-confluence] ${spaceKey}: invalid JSON as ${cand.label}: ${spaceBody.slice(0, 160)}`);
            continue;
          }
          const id = spaceData.results?.[0]?.id;
          if (!id) {
            this.diag(`[kb-confluence] ${spaceKey}: not visible to ${cand.label} — trying next credential`);
            continue;
          }
          spaceId = id;
          headers = cand.headers;
          this.diag(`[kb-confluence] Space "${spaceKey}" resolved to ID ${id} as ${cand.label}`);
          break;
        }
        if (!spaceId || !headers) {
          this.diag(`[kb-confluence] Space "${spaceKey}" could not be read by any credential — check the key is right, and that the space is public or the account has access`);
          continue;
        }

        // Paginate through all pages — request ADF body format (knowledge_base spaces use ADF, not storage HTML)
        let pageUrl: string | null = `${baseUrl}/wiki/api/v2/pages?space-id=${spaceId}&body-format=atlas_doc_format&limit=50&status=current`;
        let pagesFound = 0;
        let pagesSkipped = 0;

        while (pageUrl) {
          const pageRes = await fetch(pageUrl, { headers });
          const pageBody = await pageRes.text();
          if (!pageRes.ok) {
            this.diag(`[kb-confluence] Page fetch failed: ${pageRes.status} — ${pageBody.slice(0, 300)}`);
            break;
          }
          if (!pageBody.trim()) {
            this.diag(`[kb-confluence] Empty response fetching pages — check auth`);
            break;
          }
          let pageData: {
            results: Array<{
              id: string;
              title: string;
              version: { number: number };
              body?: { atlas_doc_format?: { value: string } };
              _links?: { next?: string };
            }>;
            _links?: { next?: string };
          };
          try { pageData = JSON.parse(pageBody); } catch {
            this.diag(`[kb-confluence] Invalid JSON fetching pages: ${pageBody.slice(0, 200)}`);
            break;
          }

          const pages = pageData.results || [];
          for (let i = 0; i < pages.length; i += MAX_CONCURRENT) {
            const batch = pages.slice(i, i + MAX_CONCURRENT);
            for (const page of batch) {
              let adfValue = page.body?.atlas_doc_format?.value;

              if (!adfValue) {
                // Fallback: fetch individual page with ADF body
                try {
                  const pageDetailRes = await fetch(
                    `${baseUrl}/wiki/api/v2/pages/${page.id}?body-format=atlas_doc_format`,
                    { headers }
                  );
                  if (pageDetailRes.ok) {
                    const pageDetail = await pageDetailRes.json();
                    adfValue = pageDetail.body?.atlas_doc_format?.value;
                  }
                  if (!adfValue) {
                    pagesSkipped++;
                    continue;
                  }
                } catch {
                  pagesSkipped++;
                  continue;
                }
              }

              const doc = this.pageToDocument(page, adfValue, spaceKey, baseUrl);
              if (doc) {
                pagesFound++;
                yield doc;
              } else {
                pagesSkipped++;
              }
            }
          }

          // Follow pagination cursor
          const nextLink = pageData._links?.next;
          pageUrl = nextLink ? `${baseUrl}${nextLink}` : null;
        }

        this.diag(`[kb-confluence] Space "${spaceKey}": ${pagesFound} pages processed, ${pagesSkipped} skipped (no body)`);
      } catch (err) {
        this.diag(`[kb-confluence] Error syncing space ${spaceKey}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private pageToDocument(
    page: { id: string; title: string; version: { number: number } },
    adfValue: string,
    spaceKey: string,
    baseUrl: string
  ): RawDocument | null {
    try {
      const adfObj = typeof adfValue === 'string' ? JSON.parse(adfValue) : adfValue;
      const markdown = this.adfToMarkdown(adfObj);
      if (!markdown.trim()) return null;

      return {
        sourceDocId: `${page.id}:${page.version.number}`,
        path: `${spaceKey}/${page.title}`,
        title: page.title,
        url: `${baseUrl}/wiki/spaces/${spaceKey}/pages/${page.id}`,
        markdown,
      };
    } catch (err) {
      this.diag(`[kb-confluence] Failed to convert page ${page.id} "${page.title}": ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  // ── ADF → Markdown converter ──

  private adfToMarkdown(adf: any): string {
    if (!adf || !adf.content) return '';
    return this.walkAdfNodes(adf.content).trim();
  }

  private walkAdfNodes(nodes: any[], listDepth = 0): string {
    let md = '';
    for (const node of nodes) {
      switch (node.type) {
        case 'heading':
          md += '#'.repeat(node.attrs?.level || 1) + ' ' + this.extractText(node) + '\n\n';
          break;
        case 'paragraph':
          md += this.extractText(node) + '\n\n';
          break;
        case 'codeBlock':
          md += '```' + (node.attrs?.language || '') + '\n' + this.extractText(node) + '\n```\n\n';
          break;
        case 'bulletList':
          md += this.walkList(node.content || [], '- ', listDepth);
          break;
        case 'orderedList':
          md += this.walkList(node.content || [], '1. ', listDepth);
          break;
        case 'table':
          md += this.walkTable(node) + '\n';
          break;
        case 'blockCard':
        case 'inlineCard':
          md += `[${node.attrs?.url || 'link'}](${node.attrs?.url || ''})\n`;
          break;
        case 'rule':
          md += '---\n\n';
          break;
        case 'panel':
        case 'expand':
        case 'nestedExpand':
        case 'bodiedExtension':
        case 'layoutSection':
        case 'layoutColumn':
          if (node.content) md += this.walkAdfNodes(node.content, listDepth);
          break;
        default:
          if (node.content) md += this.walkAdfNodes(node.content, listDepth);
          break;
      }
    }
    return md;
  }

  private extractText(node: any): string {
    if (!node.content) return '';
    let text = '';
    for (const child of node.content) {
      if (child.type === 'text') {
        let t = child.text || '';
        if (child.marks) {
          for (const mark of child.marks) {
            switch (mark.type) {
              case 'strong': t = `**${t}**`; break;
              case 'em': t = `*${t}*`; break;
              case 'code': t = `\`${t}\``; break;
              case 'link': t = `[${t}](${mark.attrs?.href || ''})`; break;
              case 'strike': t = `~~${t}~~`; break;
            }
          }
        }
        text += t;
      } else if (child.type === 'hardBreak') {
        text += '\n';
      } else if (child.type === 'mention') {
        text += child.attrs?.text || '@unknown';
      } else if (child.type === 'emoji') {
        text += child.attrs?.shortName || '';
      } else if (child.type === 'inlineCard') {
        text += `[${child.attrs?.url || 'link'}](${child.attrs?.url || ''})`;
      } else if (child.type === 'status') {
        text += `[${child.attrs?.text || 'status'}]`;
      } else if (child.type === 'date') {
        text += child.attrs?.timestamp ? new Date(parseInt(child.attrs.timestamp)).toISOString().slice(0, 10) : '';
      } else if (child.content) {
        text += this.extractText(child);
      }
    }
    return text;
  }

  private walkList(items: any[], prefix: string, depth: number): string {
    let md = '';
    const indent = '  '.repeat(depth);
    for (const item of items) {
      if (item.type !== 'listItem') continue;
      const children = item.content || [];
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (i === 0 && child.type === 'paragraph') {
          md += indent + prefix + this.extractText(child) + '\n';
        } else if (child.type === 'bulletList') {
          md += this.walkList(child.content || [], '- ', depth + 1);
        } else if (child.type === 'orderedList') {
          md += this.walkList(child.content || [], '1. ', depth + 1);
        } else if (child.type === 'paragraph') {
          md += indent + '  ' + this.extractText(child) + '\n';
        } else if (child.content) {
          md += this.walkAdfNodes([child], depth);
        }
      }
    }
    return md + '\n';
  }

  private walkTable(node: any): string {
    if (!node.content) return '';
    const rows: string[][] = [];
    for (const row of node.content) {
      if (row.type !== 'tableRow') continue;
      const cells: string[] = [];
      for (const cell of (row.content || [])) {
        const cellText = cell.content
          ? this.walkAdfNodes(cell.content).replace(/\n+/g, ' ').trim()
          : '';
        cells.push(cellText);
      }
      rows.push(cells);
    }
    if (rows.length === 0) return '';

    const colCount = Math.max(...rows.map(r => r.length));
    let md = '';
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i];
      while (cells.length < colCount) cells.push('');
      md += '| ' + cells.join(' | ') + ' |\n';
      if (i === 0) {
        md += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
      }
    }
    return md + '\n';
  }
}
