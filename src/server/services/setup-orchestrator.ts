/**
 * Setup Execution Orchestrator.
 * Coordinates AzDO push + Onboarding.Tool API calls for a delivery.
 * Each step is independently try/caught — failure logs the error but continues.
 */

import type { AzDoClient, FileChange } from './azdo-client.js';
import type { OnboardingToolClient } from './obtool-client.js';
import type {
  BranchQueries, BrandSettingsQueries, LogoQueries,
  InstanceSetupQueries, SetupExecutionQueries, DeliveryQueries,
} from '../db/queries.js';
import { LOGO_TYPE_DEFS } from '../../shared/brand-settings-defs.js';

export interface ExecutionResult {
  runId: number;
  status: 'complete' | 'failed' | 'partial';
  stepsRun: number;
  stepsFailed: number;
  summary: string;
  azdoPrUrl?: string;
  dryRun: boolean;
}

interface OrchestratorDeps {
  getAzdo: () => AzDoClient | null;
  getObtool: () => OnboardingToolClient | null;
  branchQueries: BranchQueries;
  brandQueries: BrandSettingsQueries;
  logoQueries: LogoQueries;
  setupQueries: InstanceSetupQueries;
  execQueries: SetupExecutionQueries;
  deliveryQueries: DeliveryQueries;
  settingsGetter: () => Record<string, string>;
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

    // Create run record
    const runId = this.deps.execQueries.createRun(deliveryId, userId);
    this.log(runId, 'init', 'info', `Starting setup execution for delivery ${deliveryId}${dryRun ? ' (DRY RUN)' : ''}`);

    let stepsRun = 0;
    let stepsFailed = 0;
    let azdoPrUrl: string | undefined;

    try {
      // ── Load delivery data ──
      const entries = this.deps.deliveryQueries.getAll();
      const delivery = entries.find(e => e.id === deliveryId);
      if (!delivery) throw new Error(`Delivery ${deliveryId} not found`);

      const brandSettings = this.deps.brandQueries.getByDelivery(deliveryId);
      const branches = this.deps.branchQueries.getByDelivery(deliveryId);
      const logos = this.deps.logoQueries.getMetadataByDelivery(deliveryId);
      const subdomain = brandSettings['subdomain'];

      this.log(runId, 'init', 'info', `Delivery: ${delivery.onboarding_id || delivery.account} | Subdomain: ${subdomain || '(not set)'}`);
      this.log(runId, 'init', 'info', `Data: ${Object.keys(brandSettings).length} brand settings, ${branches.length} branches, ${logos.length} logos`);

      if (!subdomain) {
        this.log(runId, 'init', 'error', 'Subdomain is required but not set in brand settings. Aborting.');
        this.deps.execQueries.updateRunStatus(runId, 'failed', 'Missing subdomain');
        return { runId, status: 'failed', stepsRun: 0, stepsFailed: 1, summary: 'Missing subdomain', dryRun };
      }

      if (dryRun) {
        // Validate readiness
        const issues: string[] = [];
        if (!brandSettings['companyName']) issues.push('Company Name not set');
        if (branches.length === 0) issues.push('No branches configured');
        if (logos.length === 0) issues.push('No logos uploaded');

        const azdo = this.deps.getAzdo();
        const obtool = this.deps.getObtool();
        if (!azdo && !obtool) issues.push('Neither AzDO nor Onboarding.Tool is configured');

        const summary = issues.length === 0
          ? `Ready to execute. AzDO: ${azdo ? 'yes' : 'no'}, OBTool: ${obtool ? 'yes' : 'no'}`
          : `Issues found: ${issues.join('; ')}`;

        this.log(runId, 'dry-run', issues.length === 0 ? 'success' : 'warn', summary);
        this.deps.execQueries.updateRunStatus(runId, 'complete', `Dry run: ${summary}`);
        return { runId, status: 'complete', stepsRun: 0, stepsFailed: 0, summary, dryRun: true };
      }

      const deliveryRef = delivery.onboarding_id || delivery.account || `delivery-${deliveryId}`;

      // ── AzDO Push ──
      const azdo = this.deps.getAzdo();
      if (azdo) {
        stepsRun++;
        try {
          this.log(runId, 'azdo_push', 'info', 'Pushing brand settings to Azure DevOps...');

          // Build file list
          const files: FileChange[] = [];

          // Brand settings JSON
          files.push({
            path: `/${subdomain}/brand.json`,
            content: JSON.stringify(brandSettings, null, 2),
          });

          // Branches JSON
          if (branches.length > 0) {
            files.push({
              path: `/${subdomain}/branches.json`,
              content: JSON.stringify(branches, null, 2),
            });
          }

          // Logo images
          for (const logoMeta of logos) {
            const logoFull = this.deps.logoQueries.getById(logoMeta.id);
            if (logoFull) {
              const typeDef = LOGO_TYPE_DEFS.find(t => t.type === logoMeta.logo_type);
              const ext = logoMeta.mime_type === 'image/svg+xml' ? 'svg'
                : logoMeta.mime_type === 'image/png' ? 'png' : 'jpg';
              const fileName = typeDef ? `${typeDef.key}.${ext}` : `logo-${logoMeta.logo_type}.${ext}`;
              files.push({
                path: `/${subdomain}/images/${fileName}`,
                content: logoFull.image_data,
                contentType: 'base64encoded',
              });
            }
          }

          const result = await azdo.pushBrandSettingsAndCreatePR(deliveryRef, files);
          azdoPrUrl = result.prUrl;

          // Save to delivery record
          this.deps.deliveryQueries.updateAzDoFields(deliveryId, result.branchName, result.prUrl);

          // Update setup step
          this.deps.setupQueries.updateStepStatus(deliveryId, 'azdo_push', 'complete', `PR: ${result.prUrl}`, userId);

          this.log(runId, 'azdo_push', 'success', `PR created: ${result.prUrl}`);
        } catch (err) {
          stepsFailed++;
          const msg = err instanceof Error ? err.message : String(err);
          this.log(runId, 'azdo_push', 'error', `AzDO push failed: ${msg}`);
          this.deps.setupQueries.updateStepStatus(deliveryId, 'azdo_push', 'failed', msg, userId);
        }
      } else {
        this.log(runId, 'azdo_push', 'info', 'AzDO not configured — skipping');
      }

      // ── Onboarding.Tool Steps ──
      const obtool = this.deps.getObtool();
      if (obtool) {
        const domain = `${subdomain}.nurtur.agency`;

        // Step: setup brands
        await this.runObtoolStep(runId, deliveryId, userId, 'setupBrands', async () => {
          const result = await obtool.setupBrands(domain, { settings: brandSettings });
          return result.Message;
        }, stepsRun, stepsFailed).then(r => { stepsRun = r.stepsRun; stepsFailed = r.stepsFailed; });

        // Step: setup branches
        await this.runObtoolStep(runId, deliveryId, userId, 'setupBranches', async () => {
          const result = await obtool.setupBranches(domain, { branches });
          return result.Message;
        }, stepsRun, stepsFailed).then(r => { stepsRun = r.stepsRun; stepsFailed = r.stepsFailed; });

        // Step: setup logos
        if (logos.length > 0) {
          await this.runObtoolStep(runId, deliveryId, userId, 'setupLogos', async () => {
            const logoPayloads = logos.map(meta => {
              const full = this.deps.logoQueries.getById(meta.id);
              return {
                logo_type: meta.logo_type,
                logo_label: meta.logo_label,
                mime_type: meta.mime_type,
                image_data: full?.image_data || '',
              };
            });
            const result = await obtool.setupLogos(domain, { logos: logoPayloads });
            return result.Message;
          }, stepsRun, stepsFailed).then(r => { stepsRun = r.stepsRun; stepsFailed = r.stepsFailed; });
        }

        // Step: create templates
        await this.runObtoolStep(runId, deliveryId, userId, 'setupTemplates', async () => {
          const result = await obtool.createTemplates(domain, { brandSettings });
          return result.Message;
        }, stepsRun, stepsFailed).then(r => { stepsRun = r.stepsRun; stepsFailed = r.stepsFailed; });

        // Step: confirm templates
        await this.runObtoolStep(runId, deliveryId, userId, 'confirmTemplates', async () => {
          const result = await obtool.confirmTemplates(domain);
          return result.Message;
        }, stepsRun, stepsFailed).then(r => { stepsRun = r.stepsRun; stepsFailed = r.stepsFailed; });

        // Step: create cards (direct mail)
        await this.runObtoolStep(runId, deliveryId, userId, 'setupDirectMail', async () => {
          const result = await obtool.createCards(domain, { brandSettings });
          return result.Message;
        }, stepsRun, stepsFailed).then(r => { stepsRun = r.stepsRun; stepsFailed = r.stepsFailed; });

        // Step: confirm cards
        await this.runObtoolStep(runId, deliveryId, userId, 'confirmDirectMail', async () => {
          const result = await obtool.confirmCards(domain);
          return result.Message;
        }, stepsRun, stepsFailed).then(r => { stepsRun = r.stepsRun; stepsFailed = r.stepsFailed; });

        // Step: create letterhead
        await this.runObtoolStep(runId, deliveryId, userId, 'setupLetterhead', async () => {
          const result = await obtool.createLetterhead(domain, { brandSettings });
          return result.Message;
        }, stepsRun, stepsFailed).then(r => { stepsRun = r.stepsRun; stepsFailed = r.stepsFailed; });

        // Step: confirm letterhead
        await this.runObtoolStep(runId, deliveryId, userId, 'confirmLetterhead', async () => {
          const result = await obtool.confirmLetterhead(domain);
          return result.Message;
        }, stepsRun, stepsFailed).then(r => { stepsRun = r.stepsRun; stepsFailed = r.stepsFailed; });

        // Step: setup portal
        await this.runObtoolStep(runId, deliveryId, userId, 'setupBuildPortals', async () => {
          const result = await obtool.setupPortal(domain, { brandSettings });
          return result.Message;
        }, stepsRun, stepsFailed).then(r => { stepsRun = r.stepsRun; stepsFailed = r.stepsFailed; });

      } else {
        this.log(runId, 'obtool', 'info', 'Onboarding.Tool not configured — skipping');
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
        azdoPrUrl,
        dryRun: false,
      };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(runId, 'fatal', 'error', `Fatal error: ${msg}`);
      this.deps.execQueries.updateRunStatus(runId, 'failed', msg);
      return { runId, status: 'failed', stepsRun, stepsFailed: stepsFailed + 1, summary: msg, dryRun: false };
    }
  }

  /** Helper to run an Onboarding.Tool step with logging and step status tracking. */
  private async runObtoolStep(
    runId: number,
    deliveryId: number,
    userId: number,
    stepKey: string,
    fn: () => Promise<string>,
    stepsRun: number,
    stepsFailed: number,
  ): Promise<{ stepsRun: number; stepsFailed: number }> {
    stepsRun++;
    try {
      this.log(runId, stepKey, 'info', `Running ${stepKey}...`);
      this.deps.setupQueries.updateStepStatus(deliveryId, stepKey, 'in_progress', undefined, userId);
      const message = await fn();
      this.deps.setupQueries.updateStepStatus(deliveryId, stepKey, 'complete', message, userId);
      this.log(runId, stepKey, 'success', message || 'Done');
    } catch (err) {
      stepsFailed++;
      const msg = err instanceof Error ? err.message : String(err);
      this.deps.setupQueries.updateStepStatus(deliveryId, stepKey, 'failed', msg, userId);
      this.log(runId, stepKey, 'error', `Failed: ${msg}`);
    }
    return { stepsRun, stepsFailed };
  }
}
