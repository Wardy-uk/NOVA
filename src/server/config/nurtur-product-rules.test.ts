import { describe, it } from 'node:test';
import assert from 'node:assert';

import { classifyNurturProduct, PRODUCT_UNKNOWN_LABEL, type ProductClassifyInput } from './nurtur-product-rules.js';
import {
  buildResolveFields, reconcileCloseFields, adfToText, textToAdf, CLOSE_INTENT_KEY,
  CF_NURTUR_PRODUCT, CF_PRODUCT_SUB_CATEGORY, CF_TLDR,
} from '../utils/jira-resolve-fields.js';
import { JiraRestClient } from '../services/jira-client.js';
import { descriptionFingerprint } from '../services/auto-rules-engine.js';

/**
 * Pins the Nurtur Product rules from the 25 Sep 2026 handoff. Between Jun and Sep 2026 NOVA
 * stamped Not A Nurtur Product on every close, over agent-set values: 4,265 tickets in 90
 * days, most of them alerts or real product work. Every row of the section 4 tables is here.
 */

const c = (summary: string, extra: Partial<ProductClassifyInput> = {}) => classifyNurturProduct({ summary, ...extra });

describe('4.1 System Alerts', () => {
  const rows: Array<[string, string, string?]> = [
    ['BYM Domains Removed From PMTA', 'NDC - PMTA/DKIM'],
    ['BYM Domains Will be Removed From PMTA', 'NDC - PMTA/DKIM'],
    ['CIA Letter Alerting', 'NDC - CIA Letter Alerting'],
    ['Auction House Property Alerts - Success!', 'NDC - Auction House Alerts'],
    ['Auction House Property Alerts Daily Task Status', 'NDC - Auction House Alerts'],
    ['Welcome trigger contacts OK', 'NDC - Welcome Triggers'],
    ['Triggers Not Firing Report', 'NDC - Triggers'],
    ['Failed Jobs — investigate', 'NDC - Failed Jobs'],
    ['MWU Live Morning Report', 'Integrations - MWU'],
    ['Freedom Leisure Integration Check', 'Integrations - Freedom Leisure'],
    ['PFG Interaction Stats was executed', 'Integrations - PFG'],
    ['Digival Report was executed', 'NDC - Scheduled Reports'],
    ['AllAgentsForPropertySales', 'NDC - Scheduled Reports'],
    ['AllHouseBuildersForPropertySales', 'NDC - Scheduled Reports'],
    ['[ WP Engine\'s Status Page] Scheduled maintenance', 'Websites - WP Engine Status'],
    ['[site-monitoring] example.co.uk', 'Websites - Site Monitoring'],
    ['example.co.uk is currently down', 'Websites - Site Monitoring'],
    ['MxToolbox Blacklist Alert', 'NDC - Deliverability'],
    ['DMARC weekly digest for arnoldandphillips.com', 'NDC - Deliverability'],
    ['Email Security Check Results', 'NDC - Deliverability'],
    ['Let\'s Encrypt certificates expiring', 'NDC - Deliverability'],
    ['[CloudAMQP] Queue alarm', 'Lead Management - Infrastructure'],
    ['New property alerts registration', 'Websites - Property Alerts'],
    ['A user has unsubscribed from property alerts', 'Websites - Property Alerts'],
  ];
  for (const [summary, sub] of rows) {
    it(summary, () => {
      const r = c(summary);
      assert.strictEqual(r.product, 'System Alerts');
      assert.strictEqual(r.subCategory, sub);
      assert.strictEqual(r.unknown, false);
    });
  }

  const spm = 'smart.plugin.manager@wpengine.com';
  for (const summary of [
    'andrewlodge.net 3 plugins were not updated',
    'hackett-estates.com 1 plugin was not updated',
    'hackett-estates.com 1 theme is consistently failing to update',
    'slinnresidential.co.uk 1 plugin is consistently failing to update',
    'Smart Plugin Manager could not connect to crowtherkey.co.uk',
  ]) {
    it(`SPM from WP Engine: ${summary}`, () => {
      const r = c(summary, { reporterEmail: spm });
      assert.strictEqual(r.product, 'System Alerts');
      assert.strictEqual(r.subCategory, 'Websites - WP Engine SPM');
    });
  }

  it('an SPM-looking subject from a customer is not an SPM alert (Bug 2)', () => {
    const r = c('2 plugins were not updated', { reporterEmail: 'office@agent.co.uk' });
    assert.notStrictEqual(r.subCategory, 'Websites - WP Engine SPM');
  });
});

describe('4.2 Cancellations', () => {
  const rows: Array<[string, string, string?]> = [
    ['Product Cancellation - Hosting For Smith & Co', 'The Property Jungle - Wordpress Website'],
    ['Product Cancellation - Database Licence For Smith & Co', 'The Property Jungle - Wordpress Website'],
    ['Product Cancellation - Can You Just For Smith & Co', 'The Property Jungle - Wordpress Website'],
    ['Product Cancellation - Site For Life For Smith & Co', 'The Property Jungle - Wordpress Website'],
    ['Product Cancellation - Support & Maintenance For Smith & Co', 'The Property Jungle - Wordpress Website'],
    ['Product Cancellation - Digi-Val For Smith & Co', 'Nurtur Direct Communications'],
    ['Product Cancellation - Guild Package For Smith & Co', 'Nurtur Direct Communications'],
    ['Product Cancellation - DKIM/SPF For Smith & Co', 'Nurtur Direct Communications'],
    ['Product Cancellation - Property Boost For Smith & Co', 'Nurtur Lead Management'],
    ['Product Cancellation - Ad Spend (Social) For Smith & Co', 'Social'],
    ['Product Cancellation - Ad Spend Admin Fee (Search) For Smith & Co', 'Social'],
    ['Product Cancellation - Ad Spend Admin Fee (Social) For Smith & Co', 'Social'],
    ['Product Cancellation - Management Fee (Social) For Smith & Co', 'Social'],
  ];
  for (const [summary, product] of rows) {
    it(summary, () => {
      const r = c(summary);
      assert.strictEqual(r.product, product);
      assert.match(r.subCategory, /^Cancellation - /);
      assert.strictEqual(r.unknown, false);
    });
  }

  it('Hosting cancellation for a Starberry client uses Starberry', () => {
    assert.strictEqual(c('Product Cancellation - Hosting For X', { description: 'Starberry site' }).product, 'Starberry Websites');
  });
  it('Product feed into a portal is Integrations', () => {
    assert.strictEqual(c('Product Cancellation - Product Feed For X', { description: 'Feed to Rightmove' }).product, 'Integrations');
  });
  it('Product feed into the client website uses the website rule', () => {
    assert.strictEqual(c('Product Cancellation - Product Feed For X', { description: 'feed into their website' }).product, 'The Property Jungle - Wordpress Website');
  });
  it('an unlisted cancelled product falls back with the review flag', () => {
    const r = c('Product Cancellation - Widget Plus For X');
    assert.strictEqual(r.product, 'Not A Nurtur Product');
    assert.strictEqual(r.rule, 'fallback');
    assert.strictEqual(r.unknown, true);
  });
  it('reply prefixes are ignored', () => {
    assert.strictEqual(c('RE: Product Cancellation - Property Boost For X').product, 'Nurtur Lead Management');
  });
});

describe('4.3 Finance', () => {
  for (const summary of [
    'Invoice INV-1234', 'Remittance Advice', 'Change to Direct Debit', 'Duplicate payment taken',
    'Change of billing details', 'Statement of account', 'Outstanding balance query', 'Refund request',
  ]) {
    it(summary, () => {
      const r = c(summary);
      assert.strictEqual(r.product, 'Finance');
      assert.match(r.subCategory, /^Finance - /);
    });
  }
  it('phishing NOVA already called spam is noise, not Finance', () => {
    assert.strictEqual(c('Invoice overdue - click here', { closeKind: 'spam' }).product, 'Not A Nurtur Product');
  });
  it('an auto-reply about an invoice is noise, not Finance', () => {
    assert.strictEqual(c('Automatic reply: Invoice INV-1234').product, 'Not A Nurtur Product');
  });
});

describe('4.4 Website', () => {
  for (const summary of [
    'Change of Logo on website', 'Meet the team amendments', 'CMP certificate', 'Charlton Grace - website down',
    'DNS change for new domain', 'Please set up a redirect', 'Change home page video to photo of house at night',
    'Amendment to a lettings page', 'help needed with our office pages',
  ]) {
    it(`${summary} → Wordpress when the platform is unknown`, () => {
      const r = c(summary);
      assert.strictEqual(r.product, 'The Property Jungle - Wordpress Website');
      assert.strictEqual(r.unknown, false);
    });
  }
  it('Starberry named in the body → Starberry Websites', () => {
    assert.strictEqual(c('Website update', { description: 'our Starberry site' }).product, 'Starberry Websites');
  });
  it('an STBY link → Starberry Websites', () => {
    assert.strictEqual(c('Website update', { linkedIssueKeys: ['STBY-123'] }).product, 'Starberry Websites');
  });
  it('IOMart named → IOMart Website', () => {
    assert.strictEqual(c('Website update', { description: 'hosted on IOMart' }).product, 'The Property Jungle - IOMart Website');
  });
});

describe('4.5 Customer product', () => {
  const rows: Array<[string, string, string]> = [
    ['Reapit Foundations app installed', 'Integrations', 'Reapit Foundations'],
    ['Exp- Notification of New agent joining', 'Nurtur Lead Management', 'eXp - New Agent Onboarding'],
    ['Eveleighs - LeadPro', 'Nurtur Lead Management', 'LeadPro'],
    ['Members Hub login issue', 'Members Hub', 'Members Hub'],
    ['AI Editor test sends not working', 'NDC AI Editor', 'AI Editor'],
  ];
  for (const [summary, product, sub] of rows) {
    it(summary, () => {
      const r = c(summary);
      assert.strictEqual(r.product, product);
      assert.strictEqual(r.subCategory, sub);
    });
  }
});

describe('4.6 Not A Nurtur Product, only for noise', () => {
  const rows: Array<[string, Partial<ProductClassifyInput>]> = [
    ['Grow your business with our SEO', { closeKind: 'vendor_email' }],
    ['You have won', { closeKind: 'spam' }],
    ['Automatic reply: your ticket', {}],
    ['Out of Office: back Monday', {}],
    ['Undeliverable: Your newsletter', {}],
    ['Mail delivery failed', { reporterEmail: 'mailer-daemon@example.com' }],
    ['[Ticket #12345] We have received your request', {}],
    ['Ster-Kinekor case logged', {}],
    ['Are you missing valuations? Webinar', {}],
    ['Job application - Support Analyst', {}],
    ['Microsoft partner GDAP relationship request', {}],
  ];
  for (const [summary, extra] of rows) {
    it(summary, () => {
      const r = c(summary, extra);
      assert.strictEqual(r.product, 'Not A Nurtur Product');
      assert.strictEqual(r.unknown, false, 'genuine noise is a match, not the review fallback');
    });
  }

  it('criterion 7: vendor marketing email gets Not A Nurtur Product', () => {
    assert.strictEqual(c('Boost your ROI today', { closeKind: 'auto_rule:vendor-domain-autoclose' }).product, 'Not A Nurtur Product');
  });
  it('a WP Engine status page closed by the vendor rule is still a System Alert', () => {
    assert.strictEqual(c('[ WP Engine\'s Status Page] Incident', { closeKind: 'auto_rule:vendor-domain-autoclose' }).product, 'System Alerts');
  });
  it('an unclassifiable ticket falls back, flagged for review', () => {
    const r = c('Quick question');
    assert.deepStrictEqual([r.product, r.rule, r.unknown], ['Not A Nurtur Product', 'fallback', true]);
  });
});

// ── Reconciliation: never overwrite, never leave empty ──

const empty = { product: null, subCategory: null, tldr: null };

describe('reconcileCloseFields', () => {
  it('criterion 1: NT-32366 replay keeps Members Hub / feeds / "Feed Issue"', () => {
    const { fields } = buildResolveFields({ tldr: 'quick-win auto-close (thank_you)', resolution: 'No Fault Found', comment: 'Thanks', closeKind: 'thank_you' });
    const r = reconcileCloseFields(fields, { product: 'Members Hub', subCategory: 'feeds', tldr: textToAdf('Feed Issue') }, { summary: 'Guild feed failure' });
    assert.ok(!(CF_NURTUR_PRODUCT in r.fields), 'Product must not be sent');
    assert.ok(!(CF_PRODUCT_SUB_CATEGORY in r.fields), 'Sub Category must not be sent');
    assert.strictEqual(adfToText(r.fields[CF_TLDR]), 'Feed Issue | NOVA: quick-win auto-close (thank_you)');
    assert.ok(adfToText(r.fields[CF_TLDR]).startsWith('Feed Issue'));
    assert.deepStrictEqual(r.addLabels, []);
    assert.ok(!(CLOSE_INTENT_KEY in r.fields), 'the intent marker never reaches Jira');
  });

  it('criterion 2: a PMTA ticket closes as System Alerts / NDC - PMTA/DKIM', () => {
    const { fields } = buildResolveFields({ tldr: 'Automated PMTA notice', resolution: 'No Fault Found', comment: 'x', closeKind: 'auto_rule:bym-pmta-domains' });
    const r = reconcileCloseFields(fields, empty, { summary: 'BYM Domains Removed From PMTA' });
    assert.deepStrictEqual(r.fields[CF_NURTUR_PRODUCT], { value: 'System Alerts' });
    assert.strictEqual(r.fields[CF_PRODUCT_SUB_CATEGORY], 'NDC - PMTA/DKIM');
  });

  it('criterion 8: an unclassifiable ticket gets Not A Nurtur Product + nova-product-unknown', () => {
    const { fields } = buildResolveFields({ tldr: 'note', resolution: 'No Fault Found', comment: 'x' });
    const r = reconcileCloseFields(fields, empty, { summary: 'Quick question' });
    assert.deepStrictEqual(r.fields[CF_NURTUR_PRODUCT], { value: 'Not A Nurtur Product' });
    assert.ok(r.fields[CF_PRODUCT_SUB_CATEGORY], 'Sub Category is never left empty');
    assert.deepStrictEqual(r.addLabels, [PRODUCT_UNKNOWN_LABEL]);
  });

  it('kept Product + empty Sub Category: classifier sub only when it agrees, else N/A', () => {
    const { fields } = buildResolveFields({ tldr: 'n', resolution: 'No Fault Found', comment: 'x' });
    const agree = reconcileCloseFields(fields, { product: 'System Alerts', subCategory: null, tldr: null }, { summary: 'CIA Letter Alerting' });
    assert.strictEqual(agree.fields[CF_PRODUCT_SUB_CATEGORY], 'NDC - CIA Letter Alerting');
    const disagree = reconcileCloseFields(fields, { product: 'Members Hub', subCategory: null, tldr: null }, { summary: 'CIA Letter Alerting' });
    assert.strictEqual(disagree.fields[CF_PRODUCT_SUB_CATEGORY], 'N/A');
  });

  it('a TL;DR that already has the note is not rewritten', () => {
    const { fields } = buildResolveFields({ tldr: 'quick-win auto-close (thank_you)', resolution: 'No Fault Found', comment: 'x' });
    const r = reconcileCloseFields(fields, { product: 'AI', subCategory: 's', tldr: textToAdf('Feed Issue | NOVA: quick-win auto-close (thank_you)') }, { summary: 's' });
    assert.ok(!(CF_TLDR in r.fields));
  });

  it('a human close sets their own TL;DR, but still never overwrites Product', () => {
    const { fields } = buildResolveFields({ tldr: 'Fixed the feed', resolution: 'Fix By Tech Services', comment: 'x', byHuman: true });
    const r = reconcileCloseFields(fields, { product: 'Members Hub', subCategory: 'feeds', tldr: textToAdf('Feed Issue') }, { summary: 's' });
    assert.strictEqual(adfToText(r.fields[CF_TLDR]), 'Fixed the feed');
    assert.ok(!(CF_NURTUR_PRODUCT in r.fields));
  });

  it('buildResolveFields no longer stamps Not A Nurtur Product', () => {
    const { fields } = buildResolveFields({ tldr: 'n', resolution: 'No Fault Found', comment: 'x' });
    assert.ok(!(CF_NURTUR_PRODUCT in fields));
    assert.ok(!(CF_PRODUCT_SUB_CATEGORY in fields));
  });
});

// ── End to end through the real transitionIssue, with Jira stubbed ──

function stubbedClient(issueFields: Record<string, unknown>) {
  const client = new JiraRestClient({ baseUrl: 'https://example.invalid', email: 'x', apiToken: 'y' });
  const calls: Array<{ method: string; path: string; body?: any }> = [];
  (client as any).request = async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path.startsWith('issue/')) return { key: 'NT-1', fields: issueFields };
    return undefined;
  };
  return { client, calls };
}

describe('transitionIssue close reconciliation', () => {
  it('resolving an unclassified ticket succeeds with Not A Nurtur Product + label', async () => {
    const { client, calls } = stubbedClient({ summary: 'Quick question', description: null, reporter: { emailAddress: 'a@b.com' } });
    const { fields, comment } = buildResolveFields({ tldr: 'quick-win auto-close (auto_resolved)', resolution: 'No Fault Found', comment: 'Closing', closeKind: 'auto_resolved' });
    await client.transitionIssue('NT-1', '17', { fields, comment });

    const post = calls.find(c => c.method === 'POST' && c.path === 'issue/NT-1/transitions');
    assert.ok(post, 'the transition was sent');
    assert.deepStrictEqual(post!.body.fields[CF_NURTUR_PRODUCT], { value: 'Not A Nurtur Product' });
    assert.ok(post!.body.fields[CF_PRODUCT_SUB_CATEGORY]);
    assert.ok(!(CLOSE_INTENT_KEY in post!.body.fields));
    const label = calls.find(c => c.method === 'PUT' && c.body?.update?.labels);
    assert.deepStrictEqual(label?.body.update.labels, [{ add: PRODUCT_UNKNOWN_LABEL }]);
  });

  it('never sends Product when the ticket already has one', async () => {
    const { client, calls } = stubbedClient({
      summary: 'Guild feed failure', [CF_NURTUR_PRODUCT]: { value: 'Members Hub' },
      [CF_PRODUCT_SUB_CATEGORY]: 'feeds', [CF_TLDR]: textToAdf('Feed Issue'),
    });
    const { fields, comment } = buildResolveFields({ tldr: 'quick-win auto-close (thank_you)', resolution: 'No Fault Found', comment: 'Thanks', closeKind: 'thank_you' });
    await client.transitionIssue('NT-1', '17', { fields, comment });
    const post = calls.find(c => c.method === 'POST')!;
    assert.ok(!(CF_NURTUR_PRODUCT in post.body.fields));
    assert.ok(!(CF_PRODUCT_SUB_CATEGORY in post.body.fields));
    assert.ok(adfToText(post.body.fields[CF_TLDR]).startsWith('Feed Issue'));
    assert.ok(!calls.some(c => c.body?.update?.labels));
  });

  it('a transition without the close marker is sent untouched', async () => {
    const { client, calls } = stubbedClient({});
    await client.transitionIssue('NT-1', '11', { fields: { [CF_TLDR]: textToAdf('x') } });
    assert.ok(!calls.some(c => c.method === 'GET'), 'no reconcile read for a non-close transition');
  });
});

// ── Bug 3: duplicates need the whole description to match ──

describe('descriptionFingerprint', () => {
  const template = (name: string, cid: string) => `Caution: This message comes from an external organisation.\n\nHi,\n\nPlease find attached the new onboarding request for the following EXP Agents:\n\nPLEASE ADD ALL USERS AS AGENTS NOT ADMIN\nRegistered company name will always be: EXP WORLD UK LIMITED\n\nLEADPRO SUPPORT PLEASE ALWAYS ENSURE TO ENABLE THE ABANDONED BASKET FOR IVT TO THE EMAIL ADDRESS BELOW.\n\nAgents Full Name: ${name}\n\nThank you.\n[cid:image001.png@${cid}]`;

  it('criterion 4: two eXp emails for different agents are not duplicates', () => {
    assert.notStrictEqual(descriptionFingerprint(template('Chloe Meadows', '01DD4C3C.54ECD9A0')), descriptionFingerprint(template('Roger Fagg', '01DD4C34.9EC7FDA0')));
  });
  it('the same email sent twice is a duplicate, despite a different inline-image cid', () => {
    assert.strictEqual(descriptionFingerprint(template('Chloe Meadows', '01DD4C3C.54ECD9A0')), descriptionFingerprint(template('Chloe  Meadows', '01DD4C34.9EC7FDA0')));
  });
});
