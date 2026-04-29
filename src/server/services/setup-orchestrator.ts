/**
 * Setup Execution Orchestrator.
 * Calls BriefYourMarket + BuildYourMarket + Image Service APIs directly
 * to configure a client instance from NOVA delivery data.
 * Each step is independently try/caught — failure logs the error but continues.
 */

import type { BymClient, LookupValue, PostCodeDistrict, BuildBranchPayload } from './bym-client.js';
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

      // ── Finalize ──
      // Note: Template push to AzDO is a standalone action (POST /api/setup-execution/delivery/:id/push-templates)
      // gated by the azdo_push permission area (Design role). Not part of the automated execution flow.
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
}
