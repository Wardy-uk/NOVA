/**
 * Turn NOVA's internal-note markdown into Atlassian Document Format.
 *
 * `formatInternalNote` builds markdown — `**Confidence:** 92%`, `- bullet`, `1. step`, joined
 * with newlines — and `jiraClient.addComment` wraps whatever it is given in a single ADF
 * paragraph containing a single text node. ADF does not render markdown and a text node does
 * not render newlines, so every triage note NOVA has posted arrived as one run-on paragraph
 * with literal asterisks and dashes in it. Found 18 Sep 2026, on a ticket whose customer-facing
 * KBA link had the same fault.
 *
 * Deliberately small. This handles what the note generator actually emits — paragraphs, `-`
 * and `  -` bullets, `1.` steps, `**bold**` runs and `[text](url)` links — and treats anything
 * else as plain text.
 * It is not a markdown parser and should not grow into one; if a note needs richer structure,
 * build the ADF directly rather than teaching this more syntax.
 */

interface AdfNode { type: string; text?: string; marks?: object[]; content?: AdfNode[]; attrs?: object }

/**
 * Split a line into text nodes, promoting `**bold**` to strong marks and `[text](url)` to
 * real links.
 *
 * Links are here because the triage prompt asks for them by name — it tells the model to end
 * the summary with `Relevant Confluence doc: [Article Title](URL)`. Left alone they reach the
 * reader as literal brackets, which is what a reviewer found on 19 Sep 2026 and reasonably
 * read as a rendering fault. Converting is the fix; escaping the brackets would only make the
 * literal text tidier while still not linking anywhere.
 */
function inlineNodes(line: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  // Alternation, single pass, so a bold run and a link on one line cannot swallow each other.
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) nodes.push({ type: 'text', text: line.slice(last, m.index) });
    if (m[1] !== undefined) {
      nodes.push({ type: 'text', text: m[1], marks: [{ type: 'strong' }] });
    } else {
      nodes.push({ type: 'text', text: m[2], marks: [{ type: 'link', attrs: { href: m[3] } }] });
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) nodes.push({ type: 'text', text: line.slice(last) });
  return nodes.length > 0 ? nodes : [{ type: 'text', text: line }];
}

function listItem(text: string): AdfNode {
  return { type: 'listItem', content: [{ type: 'paragraph', content: inlineNodes(text) }] };
}

export function markdownishToAdf(md: string): object {
  const lines = md.split(/\r?\n/);
  const content: AdfNode[] = [];
  let paragraph: string[] = [];
  let bullets: AdfNode[] = [];
  let ordered: AdfNode[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    content.push({ type: 'paragraph', content: inlineNodes(paragraph.join(' ')) });
    paragraph = [];
  };
  const flushBullets = () => {
    if (bullets.length === 0) return;
    content.push({ type: 'bulletList', content: bullets });
    bullets = [];
  };
  const flushOrdered = () => {
    if (ordered.length === 0) return;
    content.push({ type: 'orderedList', content: ordered });
    ordered = [];
  };
  const flushAll = () => { flushParagraph(); flushBullets(); flushOrdered(); };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') { flushAll(); continue; }

    const bullet = line.match(/^\s*-\s+(.*)$/);
    if (bullet) { flushParagraph(); flushOrdered(); bullets.push(listItem(bullet[1])); continue; }

    const num = line.match(/^\s*\d+\.\s+(.*)$/);
    if (num) { flushParagraph(); flushBullets(); ordered.push(listItem(num[1])); continue; }

    flushBullets(); flushOrdered();
    paragraph.push(line.trim());
  }
  flushAll();

  // ADF rejects an empty doc, and a note that rendered to nothing is worth seeing as itself.
  if (content.length === 0) content.push({ type: 'paragraph', content: [{ type: 'text', text: md || ' ' }] });

  return { type: 'doc', version: 1, content };
}
