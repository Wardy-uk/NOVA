/** Plain text out of a Jira ADF document, for feeding a ticket description to the reply
 *  writer. Deliberately minimal: the only consumer wants a prose snippet, not fidelity. */
export function adfText(adf: unknown): string {
  if (!adf || typeof adf !== 'object') return '';
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (typeof n.text === 'string') out.push(n.text);
    if (Array.isArray(n.content)) for (const child of n.content) walk(child);
    if (n.type === 'paragraph') out.push('\n');
  };
  walk(adf);
  return out.join(' ').replace(/[ \t]+/g, ' ').replace(/\n\s*/g, '\n').trim();
}
