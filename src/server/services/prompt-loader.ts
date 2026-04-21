import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(__dirname, '../config/prompts');

const cache = new Map<string, string>();

export function loadPrompt(name: string, vars?: Record<string, string>): string {
  let template = cache.get(name);
  if (!template) {
    const filePath = path.join(PROMPTS_DIR, `${name}.txt`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Prompt template not found: ${name}.txt`);
    }
    template = fs.readFileSync(filePath, 'utf-8');
    cache.set(name, template);
  }

  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      template = template.replaceAll(`{{${key}}}`, value);
    }
  }

  return template;
}

export function clearPromptCache(): void {
  cache.clear();
}

export function listPrompts(): string[] {
  if (!fs.existsSync(PROMPTS_DIR)) return [];
  return fs.readdirSync(PROMPTS_DIR)
    .filter(f => f.endsWith('.txt'))
    .map(f => f.replace(/\.txt$/, ''));
}
