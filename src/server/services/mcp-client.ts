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
    });
  }

  async connectAll(): Promise<void> {
    const promises = [...this.servers.keys()].map((name) => this.connect(name));
    await Promise.allSettled(promises);
  }

  async connect(name: string): Promise<boolean> {
    const server = this.servers.get(name);
    if (!server) throw new Error(`Unknown server: ${name}`);

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

      await server.client.connect(server.transport);

      // Discover tools
      const { tools } = await server.client.listTools();
      server.tools = tools.map((t) => t.name);
      server.status = 'connected';
      server.lastConnected = new Date().toISOString();

      console.log(
        `[MCP] ${name}: Connected. ${tools.length} tools available.`
      );
      return true;
    } catch (err) {
      server.status = 'error';
      server.lastError = err instanceof Error ? err.message : String(err);
      console.error(`[MCP] ${name}: Connection failed:`, server.lastError);
      return false;
    }
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> = {}
  ): Promise<unknown> {
    const server = this.servers.get(serverName);
    if (!server?.client || server.status !== 'connected') {
      throw new Error(
        `Server "${serverName}" is not connected (status: ${server?.status})`
      );
    }

    const result = await server.client.callTool({
      name: toolName,
      arguments: args,
    });

    return result;
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
