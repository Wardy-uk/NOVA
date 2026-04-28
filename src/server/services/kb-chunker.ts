import { encode } from 'gpt-tokenizer';
import type { SettingsQueries } from '../db/settings-store.js';

export interface Chunk {
  chunkIndex: number;
  headingPath: string | null;
  content: string;
  tokenCount: number;
}

interface Section {
  headingPath: string | null;
  text: string;
}

export class KbChunker {
  private targetTokens: number;
  private overlapTokens: number;
  private maxTokens: number;

  constructor(settings: SettingsQueries) {
    this.targetTokens = parseInt(settings.get('kb_chunk_target_tokens') || '600', 10);
    this.overlapTokens = parseInt(settings.get('kb_chunk_overlap_tokens') || '80', 10);
    this.maxTokens = this.targetTokens * 2;
  }

  chunk(markdown: string): Chunk[] {
    const sections = this.splitByHeadings(markdown);
    const chunks: Chunk[] = [];
    let chunkIndex = 0;

    for (const section of sections) {
      const sectionChunks = this.splitSection(section, chunkIndex);
      for (const c of sectionChunks) {
        chunks.push(c);
        chunkIndex++;
      }
    }

    return chunks;
  }

  private splitByHeadings(markdown: string): Section[] {
    const lines = markdown.split('\n');
    const sections: Section[] = [];
    const headingStack: string[] = [];
    let currentText = '';

    const pushSection = () => {
      const trimmed = currentText.trim();
      if (trimmed) {
        sections.push({
          headingPath: headingStack.length > 0 ? headingStack.join(' > ') : null,
          text: trimmed,
        });
      }
    };

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        pushSection();
        currentText = '';
        const level = headingMatch[1].length;
        const title = headingMatch[2].trim();
        while (headingStack.length >= level) headingStack.pop();
        headingStack.push(title);
      } else {
        currentText += line + '\n';
      }
    }
    pushSection();

    return sections;
  }

  private splitSection(section: Section, startIndex: number): Chunk[] {
    const tokens = encode(section.text);
    if (tokens.length <= this.maxTokens) {
      return [{
        chunkIndex: startIndex,
        headingPath: section.headingPath,
        content: section.headingPath
          ? `[${section.headingPath}]\n${section.text}`
          : section.text,
        tokenCount: tokens.length,
      }];
    }

    const chunks: Chunk[] = [];
    const paragraphs = section.text.split(/\n\n+/);
    let currentParagraphs: string[] = [];
    let currentTokens = 0;
    let idx = startIndex;

    const flush = () => {
      if (currentParagraphs.length === 0) return;
      const text = currentParagraphs.join('\n\n');
      const content = section.headingPath
        ? `[${section.headingPath}]\n${text}`
        : text;
      chunks.push({
        chunkIndex: idx++,
        headingPath: section.headingPath,
        content,
        tokenCount: encode(content).length,
      });

      // Keep overlap from end of current chunk
      const overlapParagraphs: string[] = [];
      let overlapCount = 0;
      for (let i = currentParagraphs.length - 1; i >= 0; i--) {
        const pTokens = encode(currentParagraphs[i]).length;
        if (overlapCount + pTokens > this.overlapTokens) break;
        overlapParagraphs.unshift(currentParagraphs[i]);
        overlapCount += pTokens;
      }
      currentParagraphs = overlapParagraphs;
      currentTokens = overlapCount;
    };

    for (const para of paragraphs) {
      const paraTokens = encode(para).length;
      if (currentTokens + paraTokens > this.targetTokens && currentParagraphs.length > 0) {
        flush();
      }
      currentParagraphs.push(para);
      currentTokens += paraTokens;
    }
    flush();

    return chunks;
  }
}
