export function extractText(adf: unknown): string {
  if (!adf || typeof adf !== 'object') return '';
  if (typeof adf === 'string') return adf;
  try {
    const content = (adf as any).content;
    if (!Array.isArray(content)) return JSON.stringify(adf).slice(0, 500);
    return content
      .flatMap((node: any) => {
        if (node.type === 'paragraph' && Array.isArray(node.content)) {
          return node.content.map((c: any) => c.text ?? '').join('');
        }
        return node.text ?? '';
      })
      .join('\n')
      .trim();
  } catch {
    return '';
  }
}
