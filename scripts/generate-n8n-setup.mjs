#!/usr/bin/env node
// Generates the n8n workflow JSON for NOVA Azure SQL setup + migration.
// Run: node scripts/generate-n8n-setup.mjs
// Output: scripts/n8n-nova-sql-setup.json

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationSql = fs.readFileSync(
  path.join(__dirname, '../src/server/migrations/001-sqlite-to-mssql.sql'),
  'utf8'
);

// --- Code node: Create Databases ---
const createDbCode = `
const sql = require('mssql');

const { server, username, password } = $('Connection Config').first().json;
const results = [];
let pool;

try {
  pool = await sql.connect({
    server, user: username, password,
    database: 'master',
    options: { encrypt: true, trustServerCertificate: false },
    requestTimeout: 120000,
    connectionTimeout: 30000
  });

  for (const [dbName, edition, slo] of [
    ['NOVA',     'Standard', 'S0'],
    ['NOVA_Dev', 'Basic',    'Basic']
  ]) {
    try {
      const check = await pool.request().query(
        \`SELECT 1 FROM sys.databases WHERE name = '\${dbName}'\`
      );
      if (check.recordset.length === 0) {
        await pool.request().query(
          \`CREATE DATABASE [\${dbName}] ( EDITION = '\${edition}', SERVICE_OBJECTIVE = '\${slo}' )\`
        );
        results.push({ step: \`CREATE DATABASE [\${dbName}] (\${slo})\`, status: 'success', detail: 'Created' });
      } else {
        results.push({ step: \`CREATE DATABASE [\${dbName}] (\${slo})\`, status: 'success', detail: 'Already exists' });
      }
    } catch (e) {
      results.push({ step: \`CREATE DATABASE [\${dbName}]\`, status: 'failed', error: e.message });
    }
  }
} catch (e) {
  results.push({ step: 'Connect to master', status: 'failed', error: e.message });
} finally {
  if (pool) try { await pool.close(); } catch {}
}

return results.map(r => ({ json: r }));
`.trim();

// --- Code node: Wait for DBs ---
const waitCode = `
// Azure SQL needs a few seconds after CREATE DATABASE before connections work
await new Promise(r => setTimeout(r, 15000));
return $input.all();
`.trim();

// --- Code node: Run Migrations ---
// Embed the full migration SQL via template literal.
// Escape backticks and ${} in the SQL to be safe inside a JS template literal.
const safeSql = migrationSql.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const migrateCode = `
const sql = require('mssql');

const { server, username, password } = $('Connection Config').first().json;

const migrationSql = \`${safeSql}\`;

const databases = ['NOVA_Dev', 'NOVA'];
const allResults = [];

for (const dbName of databases) {
  let pool;
  try {
    pool = await sql.connect({
      server, user: username, password,
      database: dbName,
      options: { encrypt: true, trustServerCertificate: false },
      requestTimeout: 120000,
      connectionTimeout: 30000
    });

    // Split on GO batch separator (SSMS convention)
    const batches = migrationSql
      .split(/^\\s*GO\\s*$/gm)
      .map(b => b.trim())
      .filter(b => b.length > 0 && !/^--[^\\n]*$/.test(b));

    let ok = 0;
    const errors = [];

    for (let i = 0; i < batches.length; i++) {
      try {
        await pool.request().query(batches[i]);
        ok++;
      } catch (e) {
        errors.push({
          batch: i + 1,
          preview: batches[i].substring(0, 100).replace(/\\n/g, ' '),
          error: e.message.substring(0, 300)
        });
      }
    }

    allResults.push({
      step: \`Migrate [\${dbName}]\`,
      status: errors.length === 0 ? 'success' : 'partial',
      batchesTotal: batches.length,
      batchesOk: ok,
      batchesFailed: errors.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (e) {
    allResults.push({
      step: \`Migrate [\${dbName}]\`,
      status: 'failed',
      error: e.message
    });
  } finally {
    if (pool) try { await pool.close(); } catch {}
  }
}

return allResults.map(r => ({ json: r }));
`.trim();

// --- Assemble workflow ---
const workflow = {
  name: 'NOVA — Azure SQL Setup & Migration',
  nodes: [
    {
      id: 'trigger',
      name: 'Run Setup',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [200, 300],
      parameters: {}
    },
    {
      id: 'config',
      name: 'Connection Config',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [420, 300],
      parameters: {
        mode: 'manual',
        duplicateItem: false,
        assignments: {
          assignments: [
            { id: 'a1', name: 'server',   value: 'bym-asqlep01.database.windows.net', type: 'string' },
            { id: 'a2', name: 'username', value: '',   type: 'string' },
            { id: 'a3', name: 'password', value: '',   type: 'string' }
          ]
        },
        options: {}
      }
    },
    {
      id: 'create-dbs',
      name: 'Step 1 — Create Databases',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [660, 300],
      parameters: {
        jsCode: createDbCode,
        mode: 'runOnceForAllItems'
      }
    },
    {
      id: 'wait',
      name: 'Wait for DB Provisioning',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [900, 300],
      parameters: {
        jsCode: waitCode,
        mode: 'runOnceForAllItems'
      }
    },
    {
      id: 'migrate',
      name: 'Step 2 — Run Migration',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1140, 300],
      parameters: {
        jsCode: migrateCode,
        mode: 'runOnceForAllItems'
      }
    },
    {
      id: 'instructions',
      name: 'n8n-nodes-base.stickyNote',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [160, 60],
      parameters: {
        content: `## NOVA Azure SQL Setup\n\n**Prerequisites:**\n1. Set \`NODE_FUNCTION_ALLOW_EXTERNAL=mssql\` in n8n environment\n2. Azure SQL firewall must allow your n8n host IP\n3. SQL login must have \`dbcreator\` server role (for CREATE DATABASE)\n\n**Instructions:**\n1. Fill in \`username\` and \`password\` in the Connection Config node\n2. Execute the workflow\n3. Check each step's output for success/failure\n\n**Output:** Each step returns { step, status, detail/error }`,
        height: 210,
        width: 660,
        color: 4
      }
    }
  ],
  connections: {
    'Run Setup': {
      main: [[{ node: 'Connection Config', type: 'main', index: 0 }]]
    },
    'Connection Config': {
      main: [[{ node: 'Step 1 — Create Databases', type: 'main', index: 0 }]]
    },
    'Step 1 — Create Databases': {
      main: [[{ node: 'Wait for DB Provisioning', type: 'main', index: 0 }]]
    },
    'Wait for DB Provisioning': {
      main: [[{ node: 'Step 2 — Run Migration', type: 'main', index: 0 }]]
    }
  },
  pinData: {},
  settings: { executionOrder: 'v1' },
  staticData: null,
  tags: [],
  meta: {
    instanceId: 'nova-setup'
  }
};

const outPath = path.join(__dirname, 'n8n-nova-sql-setup.json');
fs.writeFileSync(outPath, JSON.stringify(workflow, null, 2));

const stats = {
  file: outPath,
  size: `${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`,
  nodes: workflow.nodes.length,
  sqlBatches: migrationSql.split(/^\s*GO\s*$/gm).filter(b => b.trim()).length
};
console.log('Generated n8n workflow:', stats);
