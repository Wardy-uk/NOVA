import {
  classifyNurturProduct, PRODUCT_UNKNOWN_LABEL,
  type ProductClassification, type ProductClassifyInput,
} from '../config/nurtur-product-rules.js';

// Field IDs from NT project Jira workflow — discovered via /api/debug/jira-transitions
export const CF_TLDR = 'customfield_13184';
export const CF_NURTUR_PRODUCT = 'customfield_13183';
export const CF_PRODUCT_SUB_CATEGORY = 'customfield_14527';
const CF_RESOLUTION_TYPE = 'customfield_14494';

/** Sidecar key buildResolveFields puts in `fields` so transitionIssue knows this is a close
 *  it must reconcile against the live ticket. Stripped before anything is sent to Jira.
 *  It rides inside `fields` so the dozen callers that pass `{ fields, comment }` straight
 *  through, and actor.ts, which merges them into its own, carry it without changes. */
export const CLOSE_INTENT_KEY = '__novaCloseIntent';

export interface CloseIntent {
  /** Quick-win type or `auto_rule:<id>`; steers the classifier toward noise when NOVA has
   *  already judged the ticket to be spam, vendor mail or an auto-reply. */
  closeKind?: string;
  /** A human closing through NOVA's UI. Their TL;DR is theirs, not a NOVA note. */
  byHuman?: boolean;
}

export function textToAdf(text: string): object {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

const RESOLUTION_TYPE_IDS: Record<string, string> = {
  'No Fault Found': '13767',
  'Duplicate': '13765',
  'Third-Party / External Resolution': '13769',
  'Configuration Change': '13763',
  'Request Cancelled / Withdrawn': '13768',
  'User Error / How-To Guidance': '13770',
  'Fix By Tech Services': '13804',
  'Escalation': '13872',
  'KBA Supplied': '14619',
};

export interface ResolveContext {
  tldr: string;
  resolution: string;
  comment: string;
  /** Pre-built ADF body, for a comment that needs real links or paragraphs. Takes precedence
   *  over `comment`, which is still required as the plain-text fallback and for logging. */
  commentAdf?: object;
  /** Explicit Product value (option value, e.g. 'Members Hub'). Applied only if the ticket's
   *  Product is empty: an existing value is never overwritten. */
  product?: string;
  subCategory?: string;
  closeKind?: string;
  byHuman?: boolean;
}

export function buildResolveFields(ctx: ResolveContext): {
  fields: Record<string, unknown>;
  comment: { body: object };
} {
  const resolutionId = RESOLUTION_TYPE_IDS[ctx.resolution];
  if (!resolutionId) {
    console.warn(`[jira-resolve-fields] Unknown resolution type "${ctx.resolution}" — known values: ${Object.keys(RESOLUTION_TYPE_IDS).join(', ')}`);
  }

  // Product and Sub Category are NOT stamped here. The Quick Resolve validator needs them
  // non-empty, but only the live ticket says whether an agent already set them, so
  // transitionIssue fills them via reconcileCloseFields() when it sees the intent below.
  // This used to write Not A Nurtur Product / 'N/A' unconditionally, over agent values
  // (NT-32366 lost Members Hub / feeds / "Feed Issue" to a thank_you close).
  const intent: CloseIntent = { closeKind: ctx.closeKind, byHuman: ctx.byHuman };
  const fields: Record<string, unknown> = {
    [CF_TLDR]: textToAdf(ctx.tldr),
    resolution: { name: 'Done' },
    [CLOSE_INTENT_KEY]: intent,
  };
  if (ctx.product) fields[CF_NURTUR_PRODUCT] = { value: ctx.product };
  if (ctx.subCategory) fields[CF_PRODUCT_SUB_CATEGORY] = ctx.subCategory;

  if (resolutionId) {
    fields[CF_RESOLUTION_TYPE] = { id: resolutionId };
  }

  // A caller that has built real ADF keeps it. Everything else gets the plain-text wrap,
  // which is one paragraph containing one text node — so it cannot render a link, and cannot
  // break a paragraph. A markdown link handed to it reaches the customer as literal
  // "[Title](https://...)" brackets, which is what NT-31799 was sent on 18 Sep 2026.
  const comment = {
    body: ctx.commentAdf ?? {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: ctx.comment }] }],
    },
  };

  return { fields, comment };
}

// ── Close-field reconciliation ──

/** A non-NT close: strip the intent marker and fill Product / Sub Category the way every
 *  close did before 25 Sep 2026. Only a caller-supplied value is kept. */
export function legacyCloseFields(payload: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...payload };
  delete fields[CLOSE_INTENT_KEY];
  fields[CF_NURTUR_PRODUCT] ??= { value: 'Not A Nurtur Product' };
  fields[CF_PRODUCT_SUB_CATEGORY] ??= 'N/A';
  return fields;
}

/** Plain text of an ADF node (or a string), walking nested content. */
export function adfToText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (typeof n.text === 'string') return n.text;
  if (n.type === 'hardBreak') return '\n';
  if (!Array.isArray(n.content)) return '';
  const sep = n.type === 'doc' || n.type === 'bulletList' || n.type === 'orderedList' ? '\n' : '';
  return n.content.map(adfToText).join(sep);
}

/** The ticket's values for the three close fields, as read from Jira before the close. */
export interface CurrentCloseFields {
  product: string | null;
  subCategory: string | null;
  /** TL;DR as Jira returned it: an ADF doc (API v3), a string, or null. */
  tldr: unknown;
}

export interface ReconcileResult {
  fields: Record<string, unknown>;
  addLabels: string[];
  /** Set when the classifier ran; null when the ticket's own values were all kept. */
  classification: ProductClassification | null;
  /** One entry per field decision, for the log. */
  audit: string[];
}

function isEmptyValue(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

/** Append ` | NOVA: <note>` to the last paragraph of an existing TL;DR, keeping its
 *  formatting. Returns null when the TL;DR already carries the note (nothing to write). */
export function appendTldrNote(existing: unknown, note: string): object | null {
  const existingText = adfToText(existing).trim();
  const suffix = `NOVA: ${note}`;
  if (!existingText) return textToAdf(suffix);
  if (existingText.includes(suffix)) return null;
  if (!existing || typeof existing !== 'object') return textToAdf(`${existingText} | ${suffix}`);

  const doc = JSON.parse(JSON.stringify(existing)) as { content?: Array<{ type?: string; content?: unknown[] }> };
  const blocks = Array.isArray(doc.content) ? doc.content : [];
  const last = blocks[blocks.length - 1];
  if (last && last.type === 'paragraph') {
    last.content = [...(last.content ?? []), { type: 'text', text: ` | ${suffix}` }];
  } else {
    blocks.push({ type: 'paragraph', content: [{ type: 'text', text: suffix }] });
    doc.content = blocks;
  }
  return doc;
}

/**
 * Turn a close payload built by buildResolveFields into what is safe to send for THIS
 * ticket. Pure: the caller reads the ticket and supplies `current` and `classifyInput`.
 *
 *  - Product: a non-empty value on the ticket is never overwritten. When empty, an explicit
 *    caller value is used, else classifyNurturProduct(). Never left empty (the validator
 *    would block the close), so an unclassifiable ticket gets Not A Nurtur Product plus
 *    the `nova-product-unknown` label for a human to correct.
 *  - Sub Category: same rule. When the ticket's own Product was kept and Sub Category is
 *    empty, the classifier's Sub Category is used only if it agrees on the Product,
 *    otherwise 'N/A' (the validator needs something).
 *  - TL;DR: never replaced by NOVA. Existing text gets ` | NOVA: <note>` appended.
 */
export function reconcileCloseFields(
  payload: Record<string, unknown>,
  current: CurrentCloseFields,
  classifyInput: ProductClassifyInput,
): ReconcileResult {
  const intent = (payload[CLOSE_INTENT_KEY] as CloseIntent | undefined) ?? {};
  const fields: Record<string, unknown> = { ...payload };
  delete fields[CLOSE_INTENT_KEY];
  const addLabels: string[] = [];
  const audit: string[] = [];
  let classification: ProductClassification | null = null;
  const classify = (): ProductClassification =>
    classification ??= classifyNurturProduct({ ...classifyInput, closeKind: intent.closeKind ?? classifyInput.closeKind });

  // Product
  const proposedProduct = (fields[CF_NURTUR_PRODUCT] as { value?: string } | undefined)?.value;
  let productWritten: string | null = null;
  if (!isEmptyValue(current.product)) {
    delete fields[CF_NURTUR_PRODUCT];
    audit.push(`product kept "${current.product}"`);
  } else if (proposedProduct) {
    productWritten = proposedProduct;
    audit.push(`product set "${proposedProduct}" (caller)`);
  } else {
    const c = classify();
    productWritten = c.product;
    fields[CF_NURTUR_PRODUCT] = { value: c.product };
    if (c.unknown) addLabels.push(PRODUCT_UNKNOWN_LABEL);
    audit.push(`product set "${c.product}" (${c.rule})`);
  }

  // Sub Category
  if (!isEmptyValue(current.subCategory)) {
    delete fields[CF_PRODUCT_SUB_CATEGORY];
    audit.push(`sub-category kept "${current.subCategory}"`);
  } else if (!isEmptyValue(fields[CF_PRODUCT_SUB_CATEGORY])) {
    audit.push(`sub-category set "${fields[CF_PRODUCT_SUB_CATEGORY]}" (caller)`);
  } else {
    const c = classify();
    const sub = c.product === (productWritten ?? current.product) ? c.subCategory : 'N/A';
    fields[CF_PRODUCT_SUB_CATEGORY] = sub;
    audit.push(`sub-category set "${sub}"`);
  }

  // TL;DR
  const note = adfToText(fields[CF_TLDR]).trim();
  if (note && intent.byHuman) {
    // A person typed this resolution summary into NOVA's close panel: it is theirs to set.
    audit.push('tl;dr set by human');
  } else if (note) {
    const merged = appendTldrNote(current.tldr, note);
    if (merged) {
      fields[CF_TLDR] = merged;
      audit.push(adfToText(current.tldr).trim() ? 'tl;dr appended' : 'tl;dr set');
    } else {
      delete fields[CF_TLDR];
      audit.push('tl;dr already carries the note');
    }
  }

  return { fields, addLabels, classification, audit };
}
