/**
 * Converts Atlassian Document Format (ADF) to sanitised HTML.
 * Handles text, paragraphs, headings, lists, code blocks, links, marks,
 * and — critically — mediaSingle/media nodes (inline images from Jira).
 *
 * Image src is routed through NOVA's /api/jira/attachment/:id proxy
 * to avoid Jira auth issues in the browser.
 */

interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export function adfToHtml(adf: unknown, _issueKey?: string): string {
  if (!adf) return '';
  if (typeof adf === 'string') return escapeHtml(adf);
  const node = adf as AdfNode;
  if (node.type === 'doc' && Array.isArray(node.content)) {
    return node.content.map(renderNode).join('');
  }
  return renderNode(node);
}

function renderNode(node: AdfNode): string {
  if (!node) return '';
  if (typeof node === 'string') return escapeHtml(node as string);

  switch (node.type) {
    case 'paragraph':
      return `<p>${renderChildren(node)}</p>`;
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 3, 1), 6);
      return `<h${level}>${renderChildren(node)}</h${level}>`;
    }
    case 'text':
      return renderTextWithMarks(node);
    case 'hardBreak':
      return '<br/>';
    case 'rule':
      return '<hr/>';

    case 'bulletList':
      return `<ul>${renderChildren(node)}</ul>`;
    case 'orderedList':
      return `<ol>${renderChildren(node)}</ol>`;
    case 'listItem':
      return `<li>${renderChildren(node)}</li>`;

    case 'codeBlock':
      return `<pre><code>${renderChildren(node)}</code></pre>`;
    case 'blockquote':
      return `<blockquote>${renderChildren(node)}</blockquote>`;

    case 'mediaSingle':
    case 'mediaGroup':
      return renderChildren(node);
    case 'media':
      return renderMedia(node);
    case 'mediaInline':
      return renderMedia(node);

    case 'inlineCard':
    case 'blockCard': {
      const url = node.attrs?.url as string | undefined;
      if (url) return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`;
      return '';
    }

    case 'table':
      return `<table>${renderChildren(node)}</table>`;
    case 'tableRow':
      return `<tr>${renderChildren(node)}</tr>`;
    case 'tableHeader':
      return `<th>${renderChildren(node)}</th>`;
    case 'tableCell':
      return `<td>${renderChildren(node)}</td>`;

    case 'emoji': {
      const shortName = node.attrs?.shortName as string;
      const text = node.attrs?.text as string;
      return text || shortName || '';
    }

    case 'mention': {
      const mentionText = node.attrs?.text as string;
      return `<span class="mention">${escapeHtml(mentionText || '@unknown')}</span>`;
    }

    default:
      return renderChildren(node);
  }
}

function renderChildren(node: AdfNode): string {
  if (!Array.isArray(node.content)) return '';
  return node.content.map(renderNode).join('');
}

function renderTextWithMarks(node: AdfNode): string {
  let html = escapeHtml(node.text || '');
  if (!node.marks?.length) return html;

  for (const mark of node.marks) {
    switch (mark.type) {
      case 'strong':
        html = `<strong>${html}</strong>`;
        break;
      case 'em':
        html = `<em>${html}</em>`;
        break;
      case 'code':
        html = `<code>${html}</code>`;
        break;
      case 'strike':
        html = `<s>${html}</s>`;
        break;
      case 'underline':
        html = `<u>${html}</u>`;
        break;
      case 'link': {
        const href = mark.attrs?.href as string;
        if (href) html = `<a href="${escapeAttr(href)}" target="_blank" rel="noopener">${html}</a>`;
        break;
      }
      case 'textColor': {
        const color = mark.attrs?.color as string;
        if (color) html = `<span style="color:${escapeAttr(color)}">${html}</span>`;
        break;
      }
    }
  }
  return html;
}

function getAuthToken(): string {
  return localStorage.getItem('nova_auth_token') || sessionStorage.getItem('nova_auth_token') || '';
}

function renderMedia(node: AdfNode): string {
  const id = node.attrs?.id as string;
  const mediaType = node.attrs?.type as string;
  const alt = (node.attrs?.alt as string) || 'attachment';
  const width = node.attrs?.width as number | undefined;

  if (mediaType === 'external') {
    const url = node.attrs?.url as string;
    if (url) {
      return `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" class="adf-image" ${width ? `width="${width}"` : ''}/>`;
    }
  }

  if (id) {
    const token = getAuthToken();
    const proxySrc = `/api/jira/attachment/${encodeURIComponent(id)}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    return `<img src="${escapeAttr(proxySrc)}" alt="${escapeAttr(alt)}" class="adf-image" loading="lazy" ${width ? `width="${width}"` : ''}/>`;
  }

  return `<span class="adf-media-placeholder">[attachment]</span>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
