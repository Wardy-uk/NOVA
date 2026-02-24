import { Router } from 'express';
import { z } from 'zod';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import type { SettingsQueries } from '../db/settings-store.js';
import { McpClientManager } from '../services/mcp-client.js';
import { INTEGRATIONS, buildMcpConfig } from '../services/integrations.js';
import type { Dynamics365Service } from '../services/dynamics365.js';
import type { IntegrationStatus, McpServerStatus } from '../../shared/types.js';

const execFileAsync = promisify(execFile);

function maskToken(value: string): string {
  if (!value || value.length <= 8) return '****';
  return value.slice(0, 4) + '****' + value.slice(-4);
}

const SaveSchema = z.object({
  enabled: z.boolean(),
  credentials: z.record(z.string()),
});

// Track active device code login processes (MS365 spawned processes)
const activeLogins = new Map<string, { process: ReturnType<typeof spawn>; output: string }>();
// Track active D365 login (MSAL device code — resolves when user completes)
let d365LoginPending = false;

export function createIntegrationRoutes(
  mcpManager: McpClientManager,
  settingsQueries: SettingsQueries,
  uvxCommand: string,
  getD365Service: () => Dynamics365Service | null,
  onSettingsChange?: (key: string) => void
): Router {
  const router = Router();

  // Helper: check if MS365 has cached accounts
  async function checkMs365LoggedIn(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('npx', ['@softeria/ms-365-mcp-server', '--list-accounts'], {
        timeout: 30000,
        shell: true,
      });
      const parsed = JSON.parse(stdout.trim());
      return Array.isArray(parsed.accounts) && parsed.accounts.length > 0;
    } catch {
      return false;
    }
  }

  // GET /api/integrations — list all with masked creds + status
  router.get('/', async (_req, res) => {
    const settings = settingsQueries.getAll();
    const mcpStatuses = mcpManager.getStatus();

    const results: IntegrationStatus[] = [];

    for (const integ of INTEGRATIONS) {
      const mcpInfo = mcpStatuses.find((s) => s.name === integ.id);
      const values: Record<string, string> = {};

      for (const field of integ.fields) {
        const raw = settings[field.key] ?? '';
        values[field.key] = field.type === 'password' && raw ? maskToken(raw) : raw;
      }

      let loggedIn = false;
      let d365Status: McpServerStatus | undefined;
      let d365Error: string | null = null;
      let d365LastConnected: string | null = null;

      if (integ.authType === 'device_code') {
        if (integ.id === 'msgraph') {
          loggedIn = await checkMs365LoggedIn();
        } else if (integ.id === 'dynamics365') {
          const svc = getD365Service();
          loggedIn = svc ? await svc.isLoggedIn() : false;
          if (svc) {
            const st = svc.getStatus();
            d365Status = st.status;
            d365Error = st.lastError;
            d365LastConnected = st.lastConnected;
          }
        }
      }

      results.push({
        id: integ.id,
        name: integ.name,
        description: integ.description,
        enabled: settings[integ.enabledKey] === 'true',
        fields: integ.fields,
        values,
        mcpStatus: d365Status ?? mcpInfo?.status ?? 'disconnected',
        lastError: d365Error ?? mcpInfo?.lastError ?? null,
        lastConnected: d365LastConnected ?? mcpInfo?.lastConnected ?? null,
        toolCount: mcpInfo?.toolCount ?? 0,
        authType: integ.authType,
        loggedIn,
      });
    }

    res.json({ ok: true, data: results });
  });

  // PUT /api/integrations/:id — save credentials + reconnect
  router.put('/:id', async (req, res) => {
    const integId = req.params.id;
    const integ = INTEGRATIONS.find((i) => i.id === integId);
    if (!integ) {
      res.status(404).json({ ok: false, error: 'Unknown integration' });
      return;
    }

    const parsed = SaveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.message });
      return;
    }

    const { enabled, credentials } = parsed.data;

    // Save enabled flag
    settingsQueries.set(integ.enabledKey, String(enabled));

    // Save credentials (skip masked values)
    for (const field of integ.fields) {
      const newValue = credentials[field.key];
      if (newValue !== undefined && !newValue.includes('****')) {
        settingsQueries.set(field.key, newValue);
      }
    }

    // Notify settings change callback (e.g. rebuild D365 service)
    if (onSettingsChange) {
      onSettingsChange(integ.enabledKey);
      for (const field of integ.fields) {
        onSettingsChange(field.key);
      }
    }

    // Reconnect MCP (skip for non-MCP integrations like dynamics365)
    const config = enabled ? buildMcpConfig(integId, settingsQueries.getAll(), uvxCommand) : null;
    if (config) {
      try {
        if (mcpManager.isRegistered(integId)) {
          await mcpManager.unregisterServer(integId);
        }
        mcpManager.registerServer(integId, config);
        await mcpManager.connectWithRetry(integId);
      } catch (err) {
        console.error(`[Integrations] Reconnect ${integId} failed:`, err);
      }
    } else if (!enabled && mcpManager.isRegistered(integId)) {
      await mcpManager.unregisterServer(integId);
    }

    const mcpInfo = mcpManager.getStatus().find((s) => s.name === integId);

    // For D365, return saved status (service rebuilt by callback above)
    if (integId === 'dynamics365') {
      const svc = getD365Service();
      const loggedIn = svc ? await svc.isLoggedIn() : false;
      res.json({ ok: true, mcpStatus: loggedIn ? 'connected' : 'configured', lastError: null });
      return;
    }

    res.json({
      ok: true,
      mcpStatus: mcpInfo?.status ?? (enabled ? 'connected' : 'disconnected'),
      lastError: mcpInfo?.lastError ?? null,
    });
  });

  // POST /api/integrations/:id/reconnect — retry without saving
  router.post('/:id/reconnect', async (req, res) => {
    const integId = req.params.id;
    if (!INTEGRATIONS.find((i) => i.id === integId)) {
      res.status(404).json({ ok: false, error: 'Unknown integration' });
      return;
    }

    try {
      if (mcpManager.isRegistered(integId)) {
        await mcpManager.disconnect(integId);
        await mcpManager.connectWithRetry(integId);
      } else {
        const settings = settingsQueries.getAll();
        const config = buildMcpConfig(integId, settings, uvxCommand);
        if (config) {
          mcpManager.registerServer(integId, config);
          await mcpManager.connectWithRetry(integId);
        }
      }

      const mcpInfo = mcpManager.getStatus().find((s) => s.name === integId);
      res.json({ ok: true, mcpStatus: mcpInfo?.status, lastError: mcpInfo?.lastError });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // POST /api/integrations/:id/login — start device code login flow
  router.post('/:id/login', (req, res) => {
    const integId = req.params.id;
    const integ = INTEGRATIONS.find((i) => i.id === integId);
    if (!integ || integ.authType !== 'device_code') {
      res.status(400).json({ ok: false, error: 'Integration does not support device code login' });
      return;
    }

    // ── D365: use MSAL device code directly ──
    if (integId === 'dynamics365') {
      const svc = getD365Service();
      if (!svc) {
        res.status(503).json({ ok: false, error: 'Dynamics 365 not configured. Save Client ID and Tenant ID first.' });
        return;
      }

      d365LoginPending = true;

      // startLogin calls the MSAL device code callback synchronously (before the token resolves)
      svc.startLogin((info) => {
        // This fires immediately with the device code
        res.json({
          ok: true,
          deviceCodeUrl: info.verificationUri,
          userCode: info.userCode,
          rawOutput: info.message,
        });
      }).then(() => {
        d365LoginPending = false;
      }).catch(() => {
        d365LoginPending = false;
      });

      return;
    }

    // ── MS365: spawn CLI process ──
    const existing = activeLogins.get(integId);
    if (existing) {
      existing.process.kill();
      activeLogins.delete(integId);
    }

    const child = spawn('npx', ['@softeria/ms-365-mcp-server', '--login'], {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';

    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
      const entry = activeLogins.get(integId);
      if (entry) entry.output = output;
    });

    child.stderr.on('data', (data: Buffer) => {
      output += data.toString();
      const entry = activeLogins.get(integId);
      if (entry) entry.output = output;
    });

    child.on('close', () => {
      activeLogins.delete(integId);
    });

    activeLogins.set(integId, { process: child, output: '' });

    // Wait a few seconds for the device code to appear in output
    setTimeout(() => {
      const entry = activeLogins.get(integId);
      const text = entry?.output ?? output;

      const urlMatch = text.match(/(https:\/\/microsoft\.com\/devicelogin\S*)/i)
        || text.match(/(https:\/\/\S*microsoft\S*\/devicelogin\S*)/i);
      const codeMatch = text.match(/code\s+([A-Z0-9]{6,12})/i)
        || text.match(/enter the code\s+([A-Z0-9]+)/i);

      res.json({
        ok: true,
        deviceCodeUrl: urlMatch?.[1] ?? 'https://microsoft.com/devicelogin',
        userCode: codeMatch?.[1] ?? null,
        rawOutput: text,
      });
    }, 5000);
  });

  // GET /api/integrations/:id/login-status — check if device code login completed
  router.get('/:id/login-status', async (req, res) => {
    const integId = req.params.id;
    const integ = INTEGRATIONS.find((i) => i.id === integId);
    if (!integ || integ.authType !== 'device_code') {
      res.status(400).json({ ok: false, error: 'Not a device code integration' });
      return;
    }

    // D365: check MSAL cache
    if (integId === 'dynamics365') {
      const svc = getD365Service();
      const loggedIn = svc ? await svc.isLoggedIn() : false;
      res.json({
        ok: true,
        loggedIn,
        loginInProgress: d365LoginPending,
        output: null,
      });
      return;
    }

    // MS365: check CLI
    const loggedIn = await checkMs365LoggedIn();
    const loginProcess = activeLogins.get(integId);

    res.json({
      ok: true,
      loggedIn,
      loginInProgress: !!loginProcess,
      output: loginProcess?.output ?? null,
    });
  });

  // POST /api/integrations/:id/logout — log out of device code auth
  router.post('/:id/logout', async (req, res) => {
    const integId = req.params.id;

    // D365: clear MSAL cache
    if (integId === 'dynamics365') {
      const svc = getD365Service();
      if (svc) {
        await svc.logout();
        res.json({ ok: true });
      } else {
        res.json({ ok: true });
      }
      return;
    }

    // MS365: CLI logout
    try {
      await execFileAsync('npx', ['@softeria/ms-365-mcp-server', '--logout'], {
        timeout: 30000,
        shell: true,
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Logout failed' });
    }
  });

  return router;
}
