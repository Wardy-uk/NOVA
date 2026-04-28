import path from 'path';
import fs from 'fs';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { KbSyncProvider, RawDocument } from './kb-sync-provider.js';
import type { SettingsQueries } from '../db/settings-store.js';

const CACHE_DIR = path.resolve('data/kb-cache/tfs-docs');

export class TfsDocsSyncProvider implements KbSyncProvider {
  readonly source = 'tfs-docs';
  private settings: SettingsQueries;

  constructor(settings: SettingsQueries) {
    this.settings = settings;
  }

  isConfigured(): boolean {
    return !!this.settings.get('tfs_docs_pat')?.trim();
  }

  private getAuthUrl(): string {
    const pat = this.settings.get('tfs_docs_pat')?.trim();
    if (!pat) throw new Error('tfs_docs_pat not configured');
    const repoUrl = this.settings.get('tfs_docs_repo_url')?.trim()
      || 'https://tfs.briefyourmarket.com/BYM2020/Core/_git/nurtur-docs';
    const url = new URL(repoUrl);
    url.username = '';
    url.password = pat;
    return url.toString();
  }

  private getBranch(): string {
    return this.settings.get('tfs_docs_branch')?.trim() || 'main';
  }

  async *fetchDocuments(): AsyncIterable<RawDocument> {
    if (!this.isConfigured()) return;

    const authUrl = this.getAuthUrl();
    const branch = this.getBranch();
    const repoUrl = this.settings.get('tfs_docs_repo_url')?.trim()
      || 'https://tfs.briefyourmarket.com/BYM2020/Core/_git/nurtur-docs';

    fs.mkdirSync(CACHE_DIR, { recursive: true });

    let git: SimpleGit;
    if (fs.existsSync(path.join(CACHE_DIR, '.git'))) {
      git = simpleGit(CACHE_DIR);
      await git.remote(['set-url', 'origin', authUrl]);
      await git.fetch('origin');
      await git.reset(['--hard', `origin/${branch}`]);
    } else {
      git = simpleGit();
      await git.clone(authUrl, CACHE_DIR, ['--branch', branch, '--single-branch']);
      git = simpleGit(CACHE_DIR);
    }

    const files = await this.walkMarkdownFiles(CACHE_DIR);
    for (const filePath of files) {
      try {
        const relativePath = path.relative(CACHE_DIR, filePath).replace(/\\/g, '/');
        const content = fs.readFileSync(filePath, 'utf-8');
        if (!content.trim()) continue;

        const blobSha = await git.raw(['hash-object', filePath]);
        const title = this.extractTitle(content, relativePath);
        const url = `${repoUrl}?path=/${encodeURIComponent(relativePath)}`;

        yield {
          sourceDocId: blobSha.trim(),
          path: relativePath,
          title,
          url,
          markdown: content,
        };
      } catch (err) {
        console.warn(`[kb-tfs] Failed to process ${filePath}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  private extractTitle(content: string, filename: string): string {
    const h1Match = content.match(/^#\s+(.+)/m);
    if (h1Match) return h1Match[1].trim();
    return path.basename(filename, '.md');
  }

  private async walkMarkdownFiles(dir: string): Promise<string[]> {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        results.push(...await this.walkMarkdownFiles(fullPath));
      } else if (entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
    return results;
  }
}
