import type { SettingsQueries } from '../db/settings-store.js';

export interface KbMatch {
  id: string;
  title: string;
  excerpt: string;
  relevance: number;
  url: string;
}

export class KbSearchService {
  private settings: SettingsQueries;

  constructor(settings: SettingsQueries) {
    this.settings = settings;
  }

  async search(query: string, maxResults = 3): Promise<KbMatch[]> {
    // Phase 1 stub: returns empty results.
    // Future: direct Confluence REST API search, replacing the n8n sub-workflow.
    // The n8n workflow ID is V35NGuyiqgTkY0F0 if we need to call it via webhook as interim.
    console.log(`[kb-search] Stub search for: "${query.slice(0, 80)}..." (no results)`);
    return [];
  }

  formatForPrompt(matches: KbMatch[]): string {
    if (matches.length === 0) return 'No knowledge base articles found.';
    return matches
      .map((m, i) => `${i + 1}. [${m.id}] ${m.title} (relevance: ${m.relevance.toFixed(2)})\n   ${m.excerpt}`)
      .join('\n');
  }
}
