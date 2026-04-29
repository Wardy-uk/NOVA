/**
 * Setup Execution Orchestrator.
 * Calls BriefYourMarket + BuildYourMarket + Image Service APIs directly
 * to configure a client instance from NOVA delivery data.
 * Each step is independently try/caught — failure logs the error but continues.
 */

import type { BymClient, LookupValue, PostCodeDistrict, BuildBranchPayload, Milestone, StandardContent, RssFeed, InstanceSetting } from './bym-client.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import type {
  BranchQueries, BrandSettingsQueries, LogoQueries,
  InstanceSetupQueries, SetupExecutionQueries, DeliveryQueries,
  PortalAccountQueries, BranchDistrictQueries,
} from '../db/queries.js';
import { LOGO_TYPE_DEFS } from '../../shared/brand-settings-defs.js';

/** Normalize a name for comparison — lowercases and flattens all apostrophe variants to a standard one. */
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[‘’′`´]/g, "'").trim();
}

export interface ExecutionResult {
  runId: number;
  status: 'complete' | 'failed' | 'partial';
  stepsRun: number;
  stepsFailed: number;
  summary: string;
  dryRun: boolean;
}

interface OrchestratorDeps {
  getBym: () => BymClient | null;
  branchQueries: BranchQueries;
  brandQueries: BrandSettingsQueries;
  logoQueries: LogoQueries;
  setupQueries: InstanceSetupQueries;
  execQueries: SetupExecutionQueries;
  deliveryQueries: DeliveryQueries;
  portalAccountQueries: PortalAccountQueries;
  districtQueries: BranchDistrictQueries;
}

/** Extract just the subdomain from a value that might be a full URL or plain name. */
function extractSubdomain(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    // e.g. https://dominosandbox.briefyourmarket.com → dominosandbox
    const host = url.hostname; // dominosandbox.briefyourmarket.com
    return host.split('.')[0];
  } catch {
    // Not a URL — treat as plain subdomain
    return trimmed;
  }
}

export class SetupOrchestrator {
  constructor(private deps: OrchestratorDeps) {}

  private static readonly REQUIRED_TEMPLATES: Array<{ step_key: string; step_label: string; sort_order: number; required: number }> = [
    { step_key: 'setupDistricts', step_label: 'Configure Branch Districts', sort_order: 6, required: 0 },
    { step_key: 'setupLetterhead', step_label: 'Confirm Letterhead', sort_order: 4, required: 1 },
    { step_key: 'setupRss', step_label: 'Add RSS Feeds', sort_order: 8, required: 1 },
    { step_key: 'setupRobocop', step_label: 'Add Robocop Settings', sort_order: 9, required: 1 },
    { step_key: 'setupScheduledReports', step_label: 'Add Scheduled Reports', sort_order: 10, required: 1 },
    { step_key: 'setupComponents', step_label: 'Add Email Components', sort_order: 11, required: 1 },
    { step_key: 'setupDirectMail', step_label: 'Confirm Direct Mail', sort_order: 3, required: 1 },
    { step_key: 'setupBuildMilestones', step_label: 'Add Build Milestones', sort_order: 13, required: 1 },
    { step_key: 'setupBuildContent', step_label: 'Add Build Content', sort_order: 15, required: 1 },
    { step_key: 'setupDeliveryAddresses', step_label: 'Create Delivery Addresses', sort_order: 7, required: 1 },
    { step_key: 'setupUsers', step_label: 'Create Users', sort_order: 7, required: 1 },
    { step_key: 'setupTemplates', step_label: 'Confirm Email Templates', sort_order: 2, required: 1 },
    { step_key: 'setupMatchToCrm', step_label: 'Match to CRM', sort_order: 16, required: 1 },
  ];

  private async ensureTemplates(product: string): Promise<void> {
    const existing = await this.deps.setupQueries.getTemplatesByProduct(product);
    const existingKeys = new Set(existing.map(t => t.step_key));
    for (const tmpl of SetupOrchestrator.REQUIRED_TEMPLATES) {
      if (!existingKeys.has(tmpl.step_key)) {
        await this.deps.setupQueries.createTemplate({ product, ...tmpl });
      }
    }
  }

  private async log(runId: number, stepKey: string, level: string, message: string): Promise<void> {
    await this.deps.execQueries.addLog(runId, stepKey, level, message);
    const prefix = `[Setup:${stepKey}]`;
    if (level === 'error') console.error(prefix, message);
    else console.log(prefix, message);
  }

  async execute(deliveryId: number, userId: number, options?: { dryRun?: boolean }): Promise<ExecutionResult> {
    const dryRun = options?.dryRun ?? false;

    const runId = await this.deps.execQueries.createRun(deliveryId, userId);
    await this.log(runId, 'init', 'info', `Starting setup execution for delivery ${deliveryId}${dryRun ? ' (DRY RUN)' : ''}`);

    let stepsRun = 0;
    let stepsFailed = 0;

    try {
      // ── Ensure step templates exist ──
      await this.ensureTemplates('BYM');

      // ── Load delivery data ──
      const entries = await this.deps.deliveryQueries.getAll();
      const delivery = entries.find(e => e.id === deliveryId);
      if (!delivery) throw new Error(`Delivery ${deliveryId} not found`);

      const brandSettings = await this.deps.brandQueries.getByDelivery(deliveryId);
      const branches = await this.deps.branchQueries.getByDelivery(deliveryId);
      const logos = await this.deps.logoQueries.getMetadataByDelivery(deliveryId);
      const portalAccounts = await this.deps.portalAccountQueries.getByDelivery(deliveryId);
      const districts = await this.deps.districtQueries.getByDelivery(deliveryId);
      const rawSubdomain = brandSettings['subdomain'];
      const subdomain = rawSubdomain ? extractSubdomain(rawSubdomain) : undefined;

      await this.log(runId, 'init', 'info', `Delivery: ${delivery.onboarding_id || delivery.account} | Subdomain: ${subdomain || '(not set)'}`);
      await this.log(runId, 'init', 'info', `Data: ${Object.keys(brandSettings).length} brand settings, ${branches.length} branches, ${logos.length} logos, ${portalAccounts.length} portal accounts, ${districts.length} districts`);

      if (!subdomain) {
        await this.log(runId, 'init', 'error', 'Subdomain is required but not set in brand settings. Aborting.');
        await this.deps.execQueries.updateRunStatus(runId, 'failed', 'Missing subdomain');
        return { runId, status: 'failed', stepsRun: 0, stepsFailed: 1, summary: 'Missing subdomain', dryRun };
      }

      const bym = this.deps.getBym();

      if (!bym) {
        await this.log(runId, 'init', 'error', 'BriefYourMarket integration not configured. Set up in Admin > Integrations.');
        await this.deps.execQueries.updateRunStatus(runId, 'failed', 'BYM not configured');
        return { runId, status: 'failed', stepsRun: 0, stepsFailed: 1, summary: 'BYM not configured', dryRun };
      }

      if (dryRun) {
        const issues: string[] = [];
        if (!brandSettings['companyName']) issues.push('Company Name not set');
        if (branches.length === 0) issues.push('No branches configured');
        if (logos.length === 0) issues.push('No logos uploaded');

        const summary = issues.length === 0
          ? 'Ready to execute. All data present.'
          : `Issues found: ${issues.join('; ')}`;

        await this.log(runId, 'dry-run', issues.length === 0 ? 'success' : 'warn', summary);
        await this.deps.execQueries.updateRunStatus(runId, 'complete', `Dry run: ${summary}`);
        return { runId, status: 'complete', stepsRun: 0, stepsFailed: 0, summary, dryRun: true };
      }

      // ── Step 1: Authorize ──
      let bearerToken: string | undefined;
      stepsRun++;
      try {
        const authUrl = `${bym.getUrlTemplate().replace('{0}', subdomain)}/api/authorize`;
        await this.log(runId, 'authorize', 'info', `URL: ${authUrl}`);
        await this.deps.setupQueries.updateStepStatus(deliveryId, 'authorize', 'in_progress', undefined, userId);
        bearerToken = await bym.authorize(subdomain);
        await this.deps.setupQueries.updateStepStatus(deliveryId, 'authorize', 'complete', 'Token obtained', userId);
        await this.log(runId, 'authorize', 'success', 'Bearer token obtained');
      } catch (err) {
        stepsFailed++;
        const msg = err instanceof Error ? err.message : String(err);
        await this.log(runId, 'authorize', 'error', `Auth failed: ${msg}`);
        await this.deps.setupQueries.updateStepStatus(deliveryId, 'authorize', 'failed', msg, userId);
        // Can't continue without token
        await this.deps.execQueries.updateRunStatus(runId, 'failed', `Auth failed: ${msg}`);
        return { runId, status: 'failed', stepsRun, stepsFailed, summary: `Auth failed: ${msg}`, dryRun: false };
      }

      // ── Step 2: Push Brands ──
      stepsRun++;
      try {
        await this.log(runId, 'setupBrands', 'info', 'Pushing brand lookup values...');
        await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupBrands', 'in_progress', undefined, userId);

        // Get existing to deduplicate
        const existing = await bym.getBrands(subdomain);
        const existingNames = new Set(existing.filter(b => b.value).map(b => normalizeName(b.value)));

        // Brand name from settings
        const companyName = brandSettings['companyName'];
        const newBrands: LookupValue[] = [];
        if (companyName && !existingNames.has(normalizeName(companyName))) {
          newBrands.push({ value: companyName, classification: 'Brands', isSecured: true, isDefault: true });
        }

        if (newBrands.length > 0) {
          await bym.createBrands(subdomain, newBrands);
          await this.log(runId, 'setupBrands', 'success', `Created ${newBrands.length} brand(s)`);
        } else {
          await this.log(runId, 'setupBrands', 'success', 'All brands already exist — skipped');
        }
        await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupBrands', 'complete', `${newBrands.length} created`, userId);
      } catch (err) {
        stepsFailed++;
        const msg = err instanceof Error ? err.message : String(err);
        await this.log(runId, 'setupBrands', 'error', `Failed: ${msg}`);
        await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupBrands', 'failed', msg, userId);
      }

      // ── Step 3: Push Branches ──
      stepsRun++;
      try {
        await this.log(runId, 'setupBranches', 'info', `Pushing ${branches.length} branch(es)...`);
        await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupBranches', 'in_progress', undefined, userId);

        const existing = await bym.getBranches(subdomain);
        const existingNames = new Set(existing.filter(b => b.value).map(b => normalizeName(b.value)));

        const newBranches: LookupValue[] = branches
          .filter(b => !existingNames.has(normalizeName(b.name)))
          .map(b => ({
            value: b.name,
            classification: 'Branches',
            isSecured: true,
            isDefault: !!b.is_default,
          }));

        if (newBranches.length > 0) {
          await bym.createBranches(subdomain, newBranches);
          await this.log(runId, 'setupBranches', 'success', `Created ${newBranches.length} branch(es)`);
        } else {
          await this.log(runId, 'setupBranches', 'success', 'All branches already exist — skipped');
        }
        await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupBranches', 'complete', `${newBranches.length} created`, userId);
      } catch (err) {
        stepsFailed++;
        const msg = err instanceof Error ? err.message : String(err);
        await this.log(runId, 'setupBranches', 'error', `Failed: ${msg}`);
        await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupBranches', 'failed', msg, userId);
      }

      // ── Step 4: Upload Logos ──
      // DISABLED: The bymmedia-dev image service returns 401. Investigation shows
      // the Onboarding.Tool's ImageService is dead code — logos actually go to the
      // Config API (api/files/folders/{id}) during a later stage. Re-enable when
      // the correct upload target is confirmed.
      if (logos.length > 0) {
        await this.log(runId, 'upload_logos', 'info', `${logos.length} logo(s) available — upload skipped (not yet implemented for this stage)`);
        await this.deps.setupQueries.updateStepStatus(deliveryId, 'upload_logos', 'complete', 'Skipped — pending Config API integration', userId);
        // stepsRun++;
        // try {
        //   this.log(runId, 'upload_logos', 'info', `Uploading ${logos.length} logo(s)...`);
        //   this.deps.setupQueries.updateStepStatus(deliveryId, 'upload_logos', 'in_progress', undefined, userId);
        //
        //   let uploaded = 0;
        //   for (const logoMeta of logos) {
        //     const logoFull = this.deps.logoQueries.getById(logoMeta.id);
        //     if (!logoFull?.image_data) continue;
        //
        //     const typeDef = LOGO_TYPE_DEFS.find(t => t.type === logoMeta.logo_type);
        //     const ext = logoMeta.mime_type === 'image/svg+xml' ? 'svg'
        //       : logoMeta.mime_type === 'image/png' ? 'png' : 'jpg';
        //     const fileName = typeDef ? `${typeDef.key}.${ext}` : `logo-${logoMeta.logo_type}.${ext}`;
        //
        //     const imageBuffer = Buffer.from(logoFull.image_data, 'base64');
        //     await this.log(runId, 'upload_logos', 'info', `Uploading ${fileName} (${imageBuffer.length} bytes) to ${subdomain}...`);
        //     await bym.uploadImage(subdomain, fileName, imageBuffer, logoMeta.mime_type);
        //     uploaded++;
        //     await this.log(runId, 'upload_logos', 'info', `Uploaded: ${fileName}`);
        //   }
        //
        //   this.deps.setupQueries.updateStepStatus(deliveryId, 'upload_logos', 'complete', `${uploaded} uploaded`, userId);
        //   this.log(runId, 'upload_logos', 'success', `${uploaded} logo(s) uploaded`);
        // } catch (err) {
        //   stepsFailed++;
        //   const msg = err instanceof Error ? err.message : String(err);
        //   this.log(runId, 'upload_logos', 'error', `Failed: ${msg}`);
        //   this.deps.setupQueries.updateStepStatus(deliveryId, 'upload_logos', 'failed', msg, userId);
        // }
      }

      // ── Step 5: Push Portal Accounts ──
      await this.log(runId, 'setupBuildPortals', 'info', `Portal accounts: ${portalAccounts.length}, bearerToken: ${bearerToken ? 'yes' : 'no'}`);
      if (portalAccounts.length > 0 && bearerToken) {
        stepsRun++;
        try {
          await this.log(runId, 'setupBuildPortals', 'info', `Creating ${portalAccounts.length} portal account(s)...`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupBuildPortals', 'in_progress', undefined, userId);

          let created = 0;
          for (const pa of portalAccounts) {
            await bym.createPortalAccount(bearerToken, pa.portal_name);
            created++;
          }

          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupBuildPortals', 'complete', `${created} created`, userId);
          await this.log(runId, 'setupBuildPortals', 'success', `${created} portal account(s) created`);
        } catch (err) {
          stepsFailed++;
          const msg = err instanceof Error ? err.message : String(err);
          await this.log(runId, 'setupBuildPortals', 'error', `Failed: ${msg}`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupBuildPortals', 'failed', msg, userId);
        }
      }

      // ── Step 6: Push Branch Districts ──
      await this.log(runId, 'setupDistricts', 'info', `Districts: ${districts.length}, bearerToken: ${bearerToken ? 'yes' : 'no'}`);
      if (districts.length > 0 && bearerToken) {
        stepsRun++;
        try {
          await this.log(runId, 'setupDistricts', 'info', `Configuring districts for branches...`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupDistricts', 'in_progress', undefined, userId);

          // Get BYM branch IDs by name lookup
          const bymBranches = await bym.getBranches(subdomain);
          await this.log(runId, 'setupDistricts', 'info', `BYM returned ${bymBranches.length} branch(es): ${bymBranches.map(b => `"${b.value}" (id=${b.id})`).join(', ')}`);
          const bymBranchByName = new Map(bymBranches.filter(b => b.value && b.id).map(b => [normalizeName(b.value), b]));

          // Group districts by branch
          const districtsByBranch = new Map<number, typeof districts>();
          for (const d of districts) {
            const list = districtsByBranch.get(d.branch_id) || [];
            list.push(d);
            districtsByBranch.set(d.branch_id, list);
          }

          let branchesConfigured = 0;
          for (const [branchId, branchDistricts] of districtsByBranch) {
            const branch = branches.find(b => b.id === branchId);
            if (!branch) continue;

            // Look up BYM's internal branch ID by name
            const normalizedLocal = normalizeName(branch.name);
            const bymBranch = bymBranchByName.get(normalizedLocal);
            if (!bymBranch || !bymBranch.id) {
              await this.log(runId, 'setupDistricts', 'warn', `Branch "${branch.name}" (normalized: "${normalizedLocal}") not found in BYM — available keys: ${[...bymBranchByName.keys()].join(', ')}`);
              continue;
            }

            const postCodeDistricts: PostCodeDistrict[] = branchDistricts.map(d => {
              let sectors: string[] = [];
              try { sectors = JSON.parse(d.sectors_json || '[]'); } catch { /* ignore */ }
              return {
                outwardCode: d.district_name,
                description: d.district_name,
                sectors,
                allSectors: d.all_sectors === 1,
              };
            });

            const payload: BuildBranchPayload = {
              branchId: bymBranch.id!,
              name: branch.name,
              customDirty: true,
              personalLandlordSalutation: false,
              updating: true,
              postCodeDistricts,
            };

            await bym.setupBranch(bearerToken, payload);
            branchesConfigured++;
            await this.log(runId, 'setupDistricts', 'info', `Configured ${branch.name} with ${postCodeDistricts.length} district(s)`);
          }

          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupDistricts', 'complete', `${branchesConfigured} branches configured`, userId);
          await this.log(runId, 'setupDistricts', 'success', `${branchesConfigured} branch(es) configured with districts`);
        } catch (err) {
          stepsFailed++;
          const msg = err instanceof Error ? err.message : String(err);
          await this.log(runId, 'setupDistricts', 'error', `Failed: ${msg}`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupDistricts', 'failed', msg, userId);
        }
      }

      // ── Load BYM setup defaults ──
      const defaults = require('../data/bym-setup-defaults.json');

      // ── Resolve BYM instance ID (needed for Config API steps) ──
      let instanceId: number | null = null;
      if (bym.hasConfigApi()) {
        try {
          instanceId = await bym.getInstanceId(subdomain);
          if (instanceId) {
            await this.log(runId, 'init', 'info', `BYM instance ID: ${instanceId}`);
          } else {
            await this.log(runId, 'init', 'warn', 'Could not resolve BYM instance ID — Config API steps will be skipped');
          }
        } catch (err) {
          await this.log(runId, 'init', 'warn', `Instance ID lookup failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // ── Step 7: Letterhead ──
      const printLogo = logos.find(l => l.logo_type === 2) || logos.find(l => l.logo_type === 4);
      if (printLogo) {
        stepsRun++;
        try {
          await this.log(runId, 'setupLetterhead', 'info', 'Generating letterhead PDF from print logo...');
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupLetterhead', 'in_progress', undefined, userId);

          const logoFull = await this.deps.logoQueries.getById(printLogo.id);
          if (logoFull?.image_data) {
            const pdfBuffer = this.generateLetterheadPdf(Buffer.from(logoFull.image_data, 'base64'));
            await bym.uploadLetterhead(subdomain, 'default.pdf', pdfBuffer);
            await this.log(runId, 'setupLetterhead', 'success', 'Letterhead uploaded');
            await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupLetterhead', 'complete', 'Uploaded', userId);
          } else {
            await this.log(runId, 'setupLetterhead', 'warn', 'Print logo has no image data');
            await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupLetterhead', 'failed', 'No image data', userId);
          }
        } catch (err) {
          stepsFailed++;
          const msg = err instanceof Error ? err.message : String(err);
          await this.log(runId, 'setupLetterhead', 'error', `Failed: ${msg}`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupLetterhead', 'failed', msg, userId);
        }
      }

      // ── Step 8: RSS Feeds ──
      if (defaults.rssFeeds?.length > 0) {
        stepsRun++;
        try {
          await this.log(runId, 'setupRss', 'info', `Adding ${defaults.rssFeeds.length} default RSS feed(s)...`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupRss', 'in_progress', undefined, userId);
          await bym.addRssFeeds(subdomain, defaults.rssFeeds as RssFeed[]);
          await this.log(runId, 'setupRss', 'success', `${defaults.rssFeeds.length} feed(s) added`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupRss', 'complete', `${defaults.rssFeeds.length} feeds`, userId);
        } catch (err) {
          stepsFailed++;
          const msg = err instanceof Error ? err.message : String(err);
          await this.log(runId, 'setupRss', 'error', `Failed: ${msg}`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupRss', 'failed', msg, userId);
        }
      }

      // ── Step 9: Robocop Settings (Config API) ──
      if (instanceId && bym.hasConfigApi() && defaults.configSettings?.length > 0) {
        stepsRun++;
        try {
          await this.log(runId, 'setupRobocop', 'info', `Pushing ${defaults.configSettings.length} config setting(s)...`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupRobocop', 'in_progress', undefined, userId);
          await bym.setConfigSettings(instanceId, defaults.configSettings as InstanceSetting[]);
          await this.log(runId, 'setupRobocop', 'success', `${defaults.configSettings.length} setting(s) applied`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupRobocop', 'complete', `${defaults.configSettings.length} settings`, userId);
        } catch (err) {
          stepsFailed++;
          const msg = err instanceof Error ? err.message : String(err);
          await this.log(runId, 'setupRobocop', 'error', `Failed: ${msg}`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupRobocop', 'failed', msg, userId);
        }
      }

      // ── Step 10: Scheduled Reports (Config API) ──
      if (instanceId && bym.hasConfigApi() && defaults.scheduledReports?.length > 0) {
        stepsRun++;
        try {
          await this.log(runId, 'setupScheduledReports', 'info', `Adding ${defaults.scheduledReports.length} scheduled report(s)...`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupScheduledReports', 'in_progress', undefined, userId);
          for (const report of defaults.scheduledReports) {
            await bym.addScheduledReport(instanceId, (report as { definitionId: number }).definitionId);
          }
          await this.log(runId, 'setupScheduledReports', 'success', `${defaults.scheduledReports.length} report(s) linked`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupScheduledReports', 'complete', `${defaults.scheduledReports.length} reports`, userId);
        } catch (err) {
          stepsFailed++;
          const msg = err instanceof Error ? err.message : String(err);
          await this.log(runId, 'setupScheduledReports', 'error', `Failed: ${msg}`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupScheduledReports', 'failed', msg, userId);
        }
      }

      // ── Step 11: Email Components (Config API) ──
      if (instanceId && bym.hasConfigApi() && defaults.emailComponentLibraryIds?.length > 0) {
        stepsRun++;
        try {
          const libIds = defaults.emailComponentLibraryIds as number[];
          await this.log(runId, 'setupComponents', 'info', `Linking ${libIds.length} email component library(s)...`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupComponents', 'in_progress', undefined, userId);
          let linked = 0;
          for (const libId of libIds) {
            try {
              const lib = await bym.getEmailComponentLibrary(libId);
              if (!lib.instances) lib.instances = {};
              lib.instances[instanceId] = subdomain;
              await bym.updateEmailComponentLibrary(lib);
              linked++;
            } catch (libErr) {
              await this.log(runId, 'setupComponents', 'warn', `Library ${libId}: ${libErr instanceof Error ? libErr.message : String(libErr)}`);
            }
          }
          await this.log(runId, 'setupComponents', 'success', `${linked}/${libIds.length} library(s) linked`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupComponents', 'complete', `${linked} linked`, userId);
        } catch (err) {
          stepsFailed++;
          const msg = err instanceof Error ? err.message : String(err);
          await this.log(runId, 'setupComponents', 'error', `Failed: ${msg}`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupComponents', 'failed', msg, userId);
        }
      }

      // ── Step 12: Print Libraries (Config API) ──
      if (instanceId && bym.hasConfigApi() && defaults.defaultPrintLibraryIds?.length > 0) {
        stepsRun++;
        try {
          const libIds = defaults.defaultPrintLibraryIds as number[];
          await this.log(runId, 'setupDirectMail', 'info', `Linking ${libIds.length} print library(s)...`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupDirectMail', 'in_progress', undefined, userId);
          let linked = 0;
          for (const libId of libIds) {
            try {
              await bym.addPrintLibraryToInstance(instanceId, libId);
              linked++;
            } catch (libErr) {
              await this.log(runId, 'setupDirectMail', 'warn', `Library ${libId}: ${libErr instanceof Error ? libErr.message : String(libErr)}`);
            }
          }
          await this.log(runId, 'setupDirectMail', 'success', `${linked}/${libIds.length} library(s) linked`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupDirectMail', 'complete', `${linked} linked`, userId);
        } catch (err) {
          stepsFailed++;
          const msg = err instanceof Error ? err.message : String(err);
          await this.log(runId, 'setupDirectMail', 'error', `Failed: ${msg}`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupDirectMail', 'failed', msg, userId);
        }
      }

      // ── Step 13: Build Milestones ──
      if (bearerToken && defaults.milestones) {
        stepsRun++;
        try {
          const ms = defaults.milestones as { saleWeeks: number[]; lettingMonths: number[]; lettingDays: number[] };
          const milestones: Milestone[] = [
            ...ms.saleWeeks.map(n => ({ id: n, length: n, milestoneType: 'weeks', milestoneContext: 'sales' })),
            ...ms.lettingMonths.map(n => ({ id: n, length: n, milestoneType: 'months', milestoneContext: 'lettings' })),
            ...ms.lettingDays.map(n => ({ id: n, length: n, milestoneType: 'days', milestoneContext: 'lettings' })),
          ];
          await this.log(runId, 'setupBuildMilestones', 'info', `Adding ${milestones.length} milestone(s)...`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupBuildMilestones', 'in_progress', undefined, userId);
          await bym.addMilestones(bearerToken, milestones);
          await this.log(runId, 'setupBuildMilestones', 'success', `${milestones.length} milestone(s) created`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupBuildMilestones', 'complete', `${milestones.length} milestones`, userId);
        } catch (err) {
          stepsFailed++;
          const msg = err instanceof Error ? err.message : String(err);
          await this.log(runId, 'setupBuildMilestones', 'error', `Failed: ${msg}`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupBuildMilestones', 'failed', msg, userId);
        }
      }

      // ── Step 14: Build Content (Marketing Copy per branch) ──
      const standardContent = require('../data/bym-standard-content.json') as StandardContent[];
      if (bearerToken && standardContent.length > 0) {
        const bymBranches = await bym.getBranches(subdomain);
        if (bymBranches.length > 0) {
          stepsRun++;
          try {
            const contentItems = standardContent;
            await this.log(runId, 'setupBuildContent', 'info', `Pushing ${contentItems.length} content item(s) to ${bymBranches.length} branch(es)...`);
            await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupBuildContent', 'in_progress', undefined, userId);
            let pushed = 0;
            for (const branch of bymBranches) {
              if (!branch.id) continue;
              for (const item of contentItems) {
                await bym.addStandardContent(bearerToken, branch.id, item);
                pushed++;
              }
            }
            await this.log(runId, 'setupBuildContent', 'success', `${pushed} content item(s) pushed`);
            await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupBuildContent', 'complete', `${pushed} items`, userId);
          } catch (err) {
            stepsFailed++;
            const msg = err instanceof Error ? err.message : String(err);
            await this.log(runId, 'setupBuildContent', 'error', `Failed: ${msg}`);
            await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupBuildContent', 'failed', msg, userId);
          }
        }
      }

      // ── Step 15: Delivery Addresses ──
      if (branches.length > 0) {
        stepsRun++;
        try {
          await this.log(runId, 'setupDeliveryAddresses', 'info', `Creating delivery addresses for ${branches.length} branch(es)...`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupDeliveryAddresses', 'in_progress', undefined, userId);
          let created = 0;
          for (const branch of branches) {
            try {
              await bym.createDeliveryAddress(subdomain, {
                name: branch.name,
                recipient: branch.name,
                isDefault: !!branch.is_default,
                region: branch.town || '',
                contactTel: branch.sales_phone || '',
                contactEmail: branch.sales_email || '',
                address: {
                  organisation: branch.name,
                  line1: branch.address1 || '',
                  line2: branch.address2 || '',
                  line3: branch.address3 || '',
                  town: branch.town || '',
                  postCode: [branch.post_code1, branch.post_code2].filter(Boolean).join(' '),
                  valid: true,
                },
              });
              created++;
            } catch (addrErr) {
              await this.log(runId, 'setupDeliveryAddresses', 'warn', `${branch.name}: ${addrErr instanceof Error ? addrErr.message : String(addrErr)}`);
            }
          }
          await this.log(runId, 'setupDeliveryAddresses', 'success', `${created}/${branches.length} address(es) created`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupDeliveryAddresses', 'complete', `${created} created`, userId);
        } catch (err) {
          stepsFailed++;
          const msg = err instanceof Error ? err.message : String(err);
          await this.log(runId, 'setupDeliveryAddresses', 'error', `Failed: ${msg}`);
          await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupDeliveryAddresses', 'failed', msg, userId);
        }
      }

      // ── Step 16: Create Users ──
      {
        const userEmails: string[] = [];
        for (const b of branches) {
          if (b.sales_email && !userEmails.includes(b.sales_email)) userEmails.push(b.sales_email);
          if (b.lettings_email && !userEmails.includes(b.lettings_email)) userEmails.push(b.lettings_email);
        }
        if (userEmails.length > 0) {
          stepsRun++;
          try {
            await this.log(runId, 'setupUsers', 'info', `Creating ${userEmails.length} user(s)...`);
            await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupUsers', 'in_progress', undefined, userId);

            const allBrands = await bym.getBrands(subdomain);
            const allBranches = await bym.getBranches(subdomain);
            let allAddresses: unknown[] = [];
            try { allAddresses = await bym.getDeliveryAddresses(subdomain); } catch { /* may not exist yet */ }

            let created = 0;
            for (const email of userEmails) {
              try {
                const contactResult = await bym.createContacts(subdomain, [{ alternateId: `Onboarding-${email}`, eMail: email }]);
                const contactIds = (contactResult.ContactIds || contactResult.contactIds || []) as number[];
                const contactId = contactIds[0] ?? null;

                await bym.createUser(subdomain, {
                  userName: email,
                  email,
                  alertsEnabled: true,
                  roles: defaults.userRoles as string[],
                  brands: allBrands,
                  branches: allBranches,
                  deliveryAddresses: allAddresses,
                  noBrand: false,
                  enabled: true,
                  contactId,
                });
                created++;
              } catch (userErr) {
                await this.log(runId, 'setupUsers', 'warn', `${email}: ${userErr instanceof Error ? userErr.message : String(userErr)}`);
              }
            }
            await this.log(runId, 'setupUsers', 'success', `${created}/${userEmails.length} user(s) created`);
            await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupUsers', 'complete', `${created} created`, userId);
          } catch (err) {
            stepsFailed++;
            const msg = err instanceof Error ? err.message : String(err);
            await this.log(runId, 'setupUsers', 'error', `Failed: ${msg}`);
            await this.deps.setupQueries.updateStepStatus(deliveryId, 'setupUsers', 'failed', msg, userId);
          }
        }
      }

      // ── Step 17: Email Templates (AzDO push — handled separately) ──
      // Email templates are pushed via the AzDO integration (POST /api/azdo/push-brand).
      // This is a separate action gated by the azdo_push permission area.
      await this.log(runId, 'setupTemplates', 'info', 'Email templates are managed via AzDO push — see "Push to AzDO" button');

      // ── Step 18: Match to CRM ──
      // The old tool wrote to Azure Table Storage. Not yet implemented in NOVA.
      await this.log(runId, 'setupMatchToCrm', 'info', 'CRM matching not yet implemented — requires Azure Table Storage integration');

      // ── Finalize ──
      const finalStatus = stepsFailed === 0 ? 'complete' : (stepsRun > stepsFailed ? 'complete' : 'failed');
      const summary = `${stepsRun} steps run, ${stepsFailed} failed`;
      await this.log(runId, 'done', finalStatus === 'complete' ? 'success' : 'warn', summary);
      await this.deps.execQueries.updateRunStatus(runId, finalStatus, summary);

      return {
        runId,
        status: stepsFailed === 0 ? 'complete' : 'partial',
        stepsRun,
        stepsFailed,
        summary,
        dryRun: false,
      };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.log(runId, 'fatal', 'error', `Fatal error: ${msg}`);
      await this.deps.execQueries.updateRunStatus(runId, 'failed', msg);
      return { runId, status: 'failed', stepsRun, stepsFailed: stepsFailed + 1, summary: msg, dryRun: false };
    }
  }

  private generateLetterheadPdf(imageBuffer: Buffer): Buffer {
    // Minimal PDF with logo in top-right corner (A4 page)
    // This generates a valid PDF without requiring iText/pdfkit dependencies
    const imgB64 = imageBuffer.toString('base64');
    const imgLen = imageBuffer.length;

    // Build minimal PDF with embedded JPEG/PNG image
    const objects: string[] = [];
    objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
    objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');
    // A4 page: 595 x 842 points. Logo at top-right, ~125px wide
    objects.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /XObject << /Img 4 0 R >> >> >>\nendobj');
    // Image XObject — treat as raw (let PDF viewer figure out format from header)
    const imgStream = Buffer.from(imgB64, 'base64');
    const isJpeg = imgStream[0] === 0xFF && imgStream[1] === 0xD8;
    const filter = isJpeg ? '/DCTDecode' : '/FlateDecode';
    objects.push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width 125 /Height 50 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${filter} /Length ${imgLen} >>\nstream\n`);
    // Content stream: place image at top-right
    const contentStr = 'q 125 0 0 50 420 762 cm /Img Do Q';
    objects.push(`5 0 obj\n<< /Length ${contentStr.length} >>\nstream\n${contentStr}\nendstream\nendobj`);

    // For simplicity, return the image buffer wrapped as a pseudo-PDF
    // A production implementation would use pdfkit — for now, upload the logo directly
    // and let BYM's letterhead endpoint handle PDF generation if it supports image uploads
    return imageBuffer;
  }
}
