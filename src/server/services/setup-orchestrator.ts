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

export class SetupOrchestrator {
  constructor(private deps: OrchestratorDeps) {}

  private log(runId: number, stepKey: string, level: string, message: string): void {
    this.deps.execQueries.addLog(runId, stepKey, level, message);
    const prefix = `[Setup:${stepKey}]`;
    if (level === 'error') console.error(prefix, message);
    else console.log(prefix, message);
  }

  async execute(deliveryId: number, userId: number, options?: { dryRun?: boolean }): Promise<ExecutionResult> {
    const dryRun = options?.dryRun ?? false;

    const runId = this.deps.execQueries.createRun(deliveryId, userId);
    this.log(runId, 'init', 'info', `Starting setup execution for delivery ${deliveryId}${dryRun ? ' (DRY RUN)' : ''}`);

    let stepsRun = 0;
    let stepsFailed = 0;

    try {
      // ── Load delivery data ──
      const entries = this.deps.deliveryQueries.getAll();
      const delivery = entries.find(e => e.id === deliveryId);
      if (!delivery) throw new Error(`Delivery ${deliveryId} not found`);

      const brandSettings = this.deps.brandQueries.getByDelivery(deliveryId);
      const branches = this.deps.branchQueries.getByDelivery(deliveryId);
      const logos = this.deps.logoQueries.getMetadataByDelivery(deliveryId);
      const portalAccounts = this.deps.portalAccountQueries.getByDelivery(deliveryId);
      const districts = this.deps.districtQueries.getByDelivery(deliveryId);
      const subdomain = brandSettings['subdomain'];

      this.log(runId, 'init', 'info', `Delivery: ${delivery.onboarding_id || delivery.account} | Subdomain: ${subdomain || '(not set)'}`);
      this.log(runId, 'init', 'info', `Data: ${Object.keys(brandSettings).length} brand settings, ${branches.length} branches, ${logos.length} logos, ${portalAccounts.length} portal accounts, ${districts.length} districts`);

      if (!subdomain) {
        this.log(runId, 'init', 'error', 'Subdomain is required but not set in brand settings. Aborting.');
        this.deps.execQueries.updateRunStatus(runId, 'failed', 'Missing subdomain');
        return { runId, status: 'failed', stepsRun: 0, stepsFailed: 1, summary: 'Missing subdomain', dryRun };
      }

      const bym = this.deps.getBym();

      if (!bym) {
        this.log(runId, 'init', 'error', 'BriefYourMarket integration not configured. Set up in Admin > Integrations.');
        this.deps.execQueries.updateRunStatus(runId, 'failed', 'BYM not configured');
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

        this.log(runId, 'dry-run', issues.length === 0 ? 'success' : 'warn', summary);
        this.deps.execQueries.updateRunStatus(runId, 'complete', `Dry run: ${summary}`);
        return { runId, status: 'complete', stepsRun: 0, stepsFailed: 0, summary, dryRun: true };
      }

      // ── Step 1: Authorize ──
      let bearerToken: string | undefined;
      stepsRun++;
      try {
        this.log(runId, 'authorize', 'info', `Authenticating with ${subdomain}...`);
        this.deps.setupQueries.updateStepStatus(deliveryId, 'authorize', 'in_progress', undefined, userId);
        bearerToken = await bym.authorize(subdomain);
        this.deps.setupQueries.updateStepStatus(deliveryId, 'authorize', 'complete', 'Token obtained', userId);
        this.log(runId, 'authorize', 'success', 'Bearer token obtained');
      } catch (err) {
        stepsFailed++;
        const msg = err instanceof Error ? err.message : String(err);
        this.log(runId, 'authorize', 'error', `Auth failed: ${msg}`);
        this.deps.setupQueries.updateStepStatus(deliveryId, 'authorize', 'failed', msg, userId);
        // Can't continue without token
        this.deps.execQueries.updateRunStatus(runId, 'failed', `Auth failed: ${msg}`);
        return { runId, status: 'failed', stepsRun, stepsFailed, summary: `Auth failed: ${msg}`, dryRun: false };
      }

      // ── Step 2: Push Brands ──
      stepsRun++;
      try {
        this.log(runId, 'push_brands', 'info', 'Pushing brand lookup values...');
        this.deps.setupQueries.updateStepStatus(deliveryId, 'push_brands', 'in_progress', undefined, userId);

        // Get existing to deduplicate
        const existing = await bym.getBrands(subdomain);
        const existingNames = new Set(existing.map(b => b.value.toLowerCase()));

        // Brand name from settings
        const companyName = brandSettings['companyName'];
        const newBrands: LookupValue[] = [];
        if (companyName && !existingNames.has(companyName.toLowerCase())) {
          newBrands.push({ value: companyName, classification: 'Brands', isSecured: true, isDefault: true });
        }

        if (newBrands.length > 0) {
          await bym.createBrands(subdomain, newBrands);
          this.log(runId, 'push_brands', 'success', `Created ${newBrands.length} brand(s)`);
        } else {
          this.log(runId, 'push_brands', 'success', 'All brands already exist — skipped');
        }
        this.deps.setupQueries.updateStepStatus(deliveryId, 'push_brands', 'complete', `${newBrands.length} created`, userId);
      } catch (err) {
        stepsFailed++;
        const msg = err instanceof Error ? err.message : String(err);
        this.log(runId, 'push_brands', 'error', `Failed: ${msg}`);
        this.deps.setupQueries.updateStepStatus(deliveryId, 'push_brands', 'failed', msg, userId);
      }

      // ── Step 3: Push Branches ──
      stepsRun++;
      try {
        this.log(runId, 'push_branches', 'info', `Pushing ${branches.length} branch(es)...`);
        this.deps.setupQueries.updateStepStatus(deliveryId, 'push_branches', 'in_progress', undefined, userId);

        const existing = await bym.getBranches(subdomain);
        const existingNames = new Set(existing.map(b => b.value.toLowerCase()));

        const newBranches: LookupValue[] = branches
          .filter(b => !existingNames.has(b.name.toLowerCase()))
          .map(b => ({
            value: b.name,
            classification: 'Branches',
            isSecured: true,
            isDefault: !!b.is_default,
          }));

        if (newBranches.length > 0) {
          await bym.createBranches(subdomain, newBranches);
          this.log(runId, 'push_branches', 'success', `Created ${newBranches.length} branch(es)`);
        } else {
          this.log(runId, 'push_branches', 'success', 'All branches already exist — skipped');
        }
        this.deps.setupQueries.updateStepStatus(deliveryId, 'push_branches', 'complete', `${newBranches.length} created`, userId);
      } catch (err) {
        stepsFailed++;
        const msg = err instanceof Error ? err.message : String(err);
        this.log(runId, 'push_branches', 'error', `Failed: ${msg}`);
        this.deps.setupQueries.updateStepStatus(deliveryId, 'push_branches', 'failed', msg, userId);
      }

      // ── Step 4: Upload Logos ──
      if (logos.length > 0) {
        stepsRun++;
        try {
          this.log(runId, 'upload_logos', 'info', `Uploading ${logos.length} logo(s)...`);
          this.deps.setupQueries.updateStepStatus(deliveryId, 'upload_logos', 'in_progress', undefined, userId);

          let uploaded = 0;
          for (const logoMeta of logos) {
            const logoFull = this.deps.logoQueries.getById(logoMeta.id);
            if (!logoFull?.image_data) continue;

            const typeDef = LOGO_TYPE_DEFS.find(t => t.type === logoMeta.logo_type);
            const ext = logoMeta.mime_type === 'image/svg+xml' ? 'svg'
              : logoMeta.mime_type === 'image/png' ? 'png' : 'jpg';
            const fileName = typeDef ? `${typeDef.key}.${ext}` : `logo-${logoMeta.logo_type}.${ext}`;

            const imageBuffer = Buffer.from(logoFull.image_data, 'base64');
            await bym.uploadImage(subdomain, fileName, imageBuffer, logoMeta.mime_type);
            uploaded++;
            this.log(runId, 'upload_logos', 'info', `Uploaded: ${fileName}`);
          }

          this.deps.setupQueries.updateStepStatus(deliveryId, 'upload_logos', 'complete', `${uploaded} uploaded`, userId);
          this.log(runId, 'upload_logos', 'success', `${uploaded} logo(s) uploaded`);
        } catch (err) {
          stepsFailed++;
          const msg = err instanceof Error ? err.message : String(err);
          this.log(runId, 'upload_logos', 'error', `Failed: ${msg}`);
          this.deps.setupQueries.updateStepStatus(deliveryId, 'upload_logos', 'failed', msg, userId);
        }
      }

      // ── Step 5: Push Portal Accounts ──
      if (portalAccounts.length > 0 && bearerToken) {
        stepsRun++;
        try {
          this.log(runId, 'push_portals', 'info', `Creating ${portalAccounts.length} portal account(s)...`);
          this.deps.setupQueries.updateStepStatus(deliveryId, 'push_portals', 'in_progress', undefined, userId);

          let created = 0;
          for (const pa of portalAccounts) {
            await bym.createPortalAccount(bearerToken, pa.portal_name);
            created++;
          }

          this.deps.setupQueries.updateStepStatus(deliveryId, 'push_portals', 'complete', `${created} created`, userId);
          this.log(runId, 'push_portals', 'success', `${created} portal account(s) created`);
        } catch (err) {
          stepsFailed++;
          const msg = err instanceof Error ? err.message : String(err);
          this.log(runId, 'push_portals', 'error', `Failed: ${msg}`);
          this.deps.setupQueries.updateStepStatus(deliveryId, 'push_portals', 'failed', msg, userId);
        }
      }

      // ── Step 6: Push Branch Districts ──
      if (districts.length > 0 && bearerToken) {
        stepsRun++;
        try {
          this.log(runId, 'push_districts', 'info', `Configuring districts for branches...`);
          this.deps.setupQueries.updateStepStatus(deliveryId, 'push_districts', 'in_progress', undefined, userId);

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
              branchId: branch.id,
              name: branch.name,
              customDirty: true,
              personalLandlordSalutation: false,
              updating: true,
              postCodeDistricts,
            };

            await bym.setupBranch(bearerToken, payload);
            branchesConfigured++;
            this.log(runId, 'push_districts', 'info', `Configured ${branch.name} with ${postCodeDistricts.length} district(s)`);
          }

          this.deps.setupQueries.updateStepStatus(deliveryId, 'push_districts', 'complete', `${branchesConfigured} branches configured`, userId);
          this.log(runId, 'push_districts', 'success', `${branchesConfigured} branch(es) configured with districts`);
        } catch (err) {
          stepsFailed++;
          const msg = err instanceof Error ? err.message : String(err);
          this.log(runId, 'push_districts', 'error', `Failed: ${msg}`);
          this.deps.setupQueries.updateStepStatus(deliveryId, 'push_districts', 'failed', msg, userId);
        }
      }

      // ── Finalize ──
      const finalStatus = stepsFailed === 0 ? 'complete' : (stepsRun > stepsFailed ? 'complete' : 'failed');
      const summary = `${stepsRun} steps run, ${stepsFailed} failed`;
      this.log(runId, 'done', finalStatus === 'complete' ? 'success' : 'warn', summary);
      this.deps.execQueries.updateRunStatus(runId, finalStatus, summary);

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
      this.log(runId, 'fatal', 'error', `Fatal error: ${msg}`);
      this.deps.execQueries.updateRunStatus(runId, 'failed', msg);
      return { runId, status: 'failed', stepsRun, stepsFailed: stepsFailed + 1, summary: msg, dryRun: false };
    }
  }
}
