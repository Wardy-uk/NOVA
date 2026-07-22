// Field IDs from NT project Jira workflow — discovered via /api/debug/jira-transitions
const CF_TLDR = 'customfield_13184';
const CF_NURTUR_PRODUCT = 'customfield_13183';
const CF_PRODUCT_SUB_CATEGORY = 'customfield_14527';
const CF_RESOLUTION_TYPE = 'customfield_14494';

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
};

const NURTUR_PRODUCT_NOT_APPLICABLE_ID = '13771';

export interface ResolveContext {
  tldr: string;
  resolution: string;
  comment: string;
  product?: string;
  subCategory?: string;
}

export function buildResolveFields(ctx: ResolveContext): {
  fields: Record<string, unknown>;
  comment: { body: object };
} {
  const resolutionId = RESOLUTION_TYPE_IDS[ctx.resolution];
  if (!resolutionId) {
    console.warn(`[jira-resolve-fields] Unknown resolution type "${ctx.resolution}" — known values: ${Object.keys(RESOLUTION_TYPE_IDS).join(', ')}`);
  }

  const fields: Record<string, unknown> = {
    [CF_TLDR]: textToAdf(ctx.tldr),
    [CF_NURTUR_PRODUCT]: { id: NURTUR_PRODUCT_NOT_APPLICABLE_ID },
    [CF_PRODUCT_SUB_CATEGORY]: ctx.subCategory ?? 'N/A',
    resolution: { name: 'Done' },
  };

  if (resolutionId) {
    fields[CF_RESOLUTION_TYPE] = { id: resolutionId };
  }

  const comment = {
    body: {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: ctx.comment }] }],
    },
  };

  return { fields, comment };
}
