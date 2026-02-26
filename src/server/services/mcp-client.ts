import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerInfo, McpServerStatus } from '../../shared/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface McpServerConnection {
  config: McpServerConfig;
  client: Client | null;
  transport: StdioClientTransport | null;
  status: McpServerStatus;
  tools: string[];
  lastError: string | null;
  lastConnected: string | null;
  reconnecting: boolean;
  _reconnectStarted?: number;
}

export class McpClientManager {
  private servers = new Map<string, McpServerConnection>();

  registerServer(name: string, config: McpServerConfig): void {
    this.servers.set(name, {
      config,
      client: null,
      transport: null,
      status: 'disconnected',
      tools: [],
      lastError: null,
      lastConnected: null,
      reconnecting: false,
    });
  }

  async connectAll(): Promise<void> {
    const promises = [...this.servers.keys()].map((name) => this.connectWithRetry(name));
    await Promise.allSettled(promises);
  }

  /** Connect with retry logic for flaky initial connections (e.g. Monday.com) */
  async connectWithRetry(name: string, maxRetries = 2): Promise<boolean> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const ok = await this.connect(name);
      if (ok) return true;

      const server = this.servers.get(name);
      // Don't retry if the command is unavailable (not a transient error)
      if (server?.status === 'unavailable') return false;

      if (attempt < maxRetries) {
        const delay = (attempt + 1) * 3000; // 3s, 6s
        console.log(`[MCP] ${name}: Retry ${attempt + 1}/${maxRetries} in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    return false;
  }

  async connect(name: string): Promise<boolean> {
    const server = this.servers.get(name);
    if (!server) throw new Error(`Unknown server: ${name}`);

    // Guard against concurrent reconnection (with staleness check — reset after 30s)
    if (server.reconnecting) {
      if (server._reconnectStarted && Date.now() - server._reconnectStarted > 30_000) {
        console.warn(`[MCP] ${name}: Reconnecting flag stuck for 30s, resetting...`);
        server.reconnecting = false;
      } else {
        return false;
      }
    }
    server.reconnecting = true;
    server._reconnectStarted = Date.now();

    // Clean up old connection if any
    if (server.client) {
      try { await server.client.close(); } catch { /* ignore */ }
      server.client = null;
      server.transport = null;
    }

    server.status = 'connecting';
    server.lastError = null;

    // Check if the command binary exists
    const commandExists = await this.checkCommand(server.config.command);
    if (!commandExists) {
      server.status = 'unavailable';
      server.lastError =
        `Command "${server.config.command}" not found. ` +
        (server.config.command === 'uvx'
          ? 'Install uv: powershell -c "irm https://astral.sh/uv/install.ps1 | iex"'
          : `Ensure ${server.config.command} is on PATH.`);
      console.warn(`[MCP] ${name}: ${server.lastError}`);
      server.reconnecting = false;
      return false;
    }

    try {
      // Resolve environment variables
      const resolvedEnv: Record<string, string> = {
        ...(process.env as Record<string, string>),
      };
      if (server.config.env) {
        for (const [k, v] of Object.entries(server.config.env)) {
          resolvedEnv[k] = v.replace(
            /\$\{(\w+)\}/g,
            (_, varName) => process.env[varName] ?? ''
          );
        }
      }

      server.transport = new StdioClientTransport({
        command: server.config.command,
        args: server.config.args,
        env: resolvedEnv,
      });

      server.client = new Client({
        name: `daypilot-${name}`,
        version: '0.1.0',
      });

      // Connect with timeout (npx downloads can stall)
      await Promise.race([
        server.client.connect(server.transport),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timed out after 30s')), 30_000)
        ),
      ]);

      // Listen for transport close to detect process crashes
      server.transport.onclose = () => {
        if (server.status === 'connected') {
          console.warn(`[MCP] ${name}: Transport closed unexpectedly — marking for reconnect`);
          server.status = 'error';
          server.lastError = 'Connection closed unexpectedly';
          server.client = null;
          server.transport = null;
        }
      };

      // Discover tools
      const { tools } = await server.client.listTools();
      server.tools = tools.map((t) => t.name);
      server.status = 'connected';
      server.lastConnected = new Date().toISOString();

      console.log(`[MCP] ${name}: Connected. ${tools.length} tools available.`);
      server.reconnecting = false;
      return true;
    } catch (err) {
      server.status = 'error';
      server.lastError = err instanceof Error ? err.message : String(err);
      console.error(`[MCP] ${name}: Connection failed:`, server.lastError);
      // Clean up partial connection on failure
      if (server.client) {
        try { await server.client.close(); } catch { /* ignore */ }
      }
      server.client = null;
      server.transport = null;
      server.reconnecting = false;
      return false;
    }
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> = {}
  ): Promise<unknown> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`Server "${serverName}" is not registered`);
    }

    // Auto-reconnect if connection was lost
    if (server.status === 'error' || (server.status === 'disconnected' && server.lastConnected)) {
      if (!server.reconnecting) {
        console.log(`[MCP] ${serverName}: Auto-reconnecting (was ${server.status})...`);
        const ok = await this.connect(serverName);
        if (!ok) {
          throw new Error(
            `Server "${serverName}" reconnection failed: ${server.lastError}`
          );
        }
      }
    }

    if (!server.client || server.status !== 'connected') {
      throw new Error(
        `Server "${serverName}" is not connected (status: ${server.status})`
      );
    }

    try {
      const result = await server.client.callTool({
        name: toolName,
        arguments: args,
      });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Detect connection-closed errors (JSON-RPC -32000) and retry once
      if (msg.includes('-32000') || msg.includes('Connection closed') || msg.includes('transport') || msg.includes('EPIPE')) {
        console.warn(`[MCP] ${serverName}: Connection lost during call to ${toolName}, reconnecting...`);
        server.status = 'error';
        server.lastError = msg;
        server.client = null;
        server.transport = null;

        const ok = await this.connect(serverName);
        if (!ok) {
          throw new Error(`Server "${serverName}" reconnection failed after call error: ${server.lastError}`);
        }

        if (!server.client) {
          throw new Error(`Server "${serverName}" reconnected but client is null`);
        }

        // Retry once
        console.log(`[MCP] ${serverName}: Retrying ${toolName} after reconnect...`);
        return server.client.callTool({ name: toolName, arguments: args });
      }
      throw err;
    }
  }

  getStatus(): McpServerInfo[] {
    return [...this.servers.entries()].map(([name, conn]) => ({
      name,
      status: conn.status,
      toolCount: conn.tools.length,
      lastError: conn.lastError,
      lastConnected: conn.lastConnected,
    }));
  }

  getServerTools(name: string): string[] {
    return this.servers.get(name)?.tools ?? [];
  }

  isConnected(name: string): boolean {
    return this.servers.get(name)?.status === 'connected';
  }

  async disconnect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) return;
    if (server.client) {
      try {
        await server.client.close();
      } catch { /* ignore cleanup errors */ }
      server.client = null;
      server.transport = null;
    }
    server.status = 'disconnected';
    server.tools = [];
    server.lastError = null;
  }

  async unregisterServer(name: string): Promise<void> {
    await this.disconnect(name);
    this.servers.delete(name);
  }

  isRegistered(name: string): boolean {
    return this.servers.has(name);
  }

  async disconnectAll(): Promise<void> {
    for (const [, server] of this.servers) {
      if (server.client) {
        try {
          await server.client.close();
        } catch {
          /* ignore cleanup errors */
        }
        server.client = null;
        server.transport = null;
        server.status = 'disconnected';
      }
    }
  }

  private async checkCommand(command: string): Promise<boolean> {
    // If command is an absolute path, check file existence
    if (path.isAbsolute(command)) {
      return fs.existsSync(command);
    }
    try {
      const checkCmd =
        process.platform === 'win32' ? `where ${command}` : `which ${command}`;
      await execAsync(checkCmd);
      return true;
    } catch {
      return false;
    }
  }
}
