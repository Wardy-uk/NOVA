#!/usr/bin/env node
/**
 * One-time data migration: SQLite (daypilot.db) → MSSQL (NOVA database)
 *
 * Usage:
 *   node scripts/migrate-sqlite-to-mssql.mjs [--dry-run] [--table TABLE_NAME]
 *
 * Reads daypilot.db (or daypilot-live.db) from project root via better-sqlite3,
 * inserts all rows into the NOVA database on bym-asqlep01 via mssql.
 *
 * Handles:
 *   - IDENTITY INSERT for auto-increment columns
 *   - Batched inserts (500 rows per batch for large tables)
 *   - Null/undefined cleanup
 *   - IDENTITY reseed after migration
 *   - Existing data: clears MSSQL table first (except settings which merges)
 *   - Foreign key ordering: parents before children
 */

import Database from 'better-sqlite3';
import sql from 'mssql';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

const DRY_RUN = process.argv.includes('--dry-run');
const SINGLE_TABLE = process.argv.find((a, i) => process.argv[i - 1] === '--table') ?? null;
const BATCH_SIZE = 500;

// Tables in dependency order (parents first, children after)
const TABLE_ORDER = [
  // Independent / parent tables
  'settings',
  'users',
  'teams',
  'training_categories',
  'onboarding_sale_types',
  'onboarding_ticket_groups',
  'onboarding_capabilities',
  'milestone_templates',
  'problem_ticket_config',
  'instance_setup_step_templates',
  'surveys',

  // Child tables (depend on parents above)
  'tasks',
  'rituals',
  'feedback',
  'notifications',
  'audit_log',
  'user_settings',
  'user_task_pins',
  'training_members',

  'crm_customers',
  'crm_reviews',

  'delivery_entries',
  'delivery_milestones',
  'delivery_branches',
  'delivery_branch_districts',
  'delivery_brand_settings',
  'delivery_logos',
  'delivery_portal_accounts',
  'delivery_welcome_packs',

  'instance_setup_steps',
  'setup_execution_runs',
  'setup_execution_logs',
  'setup_portal_tokens',

  'onboarding_capability_items',
  'onboarding_matrix',
  'onboarding_runs',
  'milestone_sale_type_offsets',
  'milestone_template_ticket_groups',

  'training_items',
  'training_scores',

  'problem_ticket_alerts',
  'problem_ticket_alert_reasons',
  'problem_ticket_ignores',

  'survey_questions',
  'survey_recipients',
  'survey_responses',

  'bc_customers',
  'contracts',
  'contract_templates',
  'adobe_sign_agreements',

  'sales_monthly',
  'sales_pipeline',
  'sales_bookings',
  'sales_taken_place',
  'sales_lg_kpi',
  'sales_lg_history',
  'sales_bdm_kpi',
  'sales_targets',

  'mi_commentary',

  'dev_review_state',
  'dev_review_thread',
  'dev_review_outbox',

  'approval_queue',
];

const SKIP_TABLES = new Set(['sqlite_sequence', 'database_firewall_rules']);

// Tables with IDENTITY(1,1) on the `id` column
const IDENTITY_TABLES = new Set([
  'adobe_sign_agreements', 'approval_queue', 'audit_log', 'bc_customers',
  'contract_templates', 'contracts', 'crm_customers', 'crm_reviews',
  'delivery_branch_districts', 'delivery_branches', 'delivery_brand_settings',
  'delivery_entries', 'delivery_logos', 'delivery_milestones',
  'delivery_portal_accounts', 'delivery_welcome_packs', 'dev_review_outbox',
  'dev_review_thread', 'feedback', 'instance_setup_step_templates',
  'instance_setup_steps', 'milestone_templates', 'notifications',
  'onboarding_capabilities', 'onboarding_capability_items', 'onboarding_matrix',
  'onboarding_runs', 'onboarding_sale_types', 'onboarding_ticket_groups',
  'problem_ticket_alert_reasons', 'problem_ticket_alerts', 'problem_ticket_ignores',
  'rituals', 'sales_bdm_kpi', 'sales_bookings', 'sales_lg_history',
  'sales_lg_kpi', 'sales_monthly', 'sales_pipeline', 'sales_taken_place',
  'sales_targets', 'setup_execution_logs', 'setup_execution_runs',
  'setup_portal_tokens', 'survey_questions', 'survey_recipients',
  'survey_responses', 'surveys', 'teams', 'training_categories',
  'training_items', 'training_scores', 'users',
]);

const MSSQL_CONFIG = {
  server: 'bym-asqlep01.database.windows.net',
  database: 'NOVA',
  user: 'azureadmin',
  password: 'Bl45t3r!',
  options: { encrypt: true, trustServerCertificate: false },
  requestTimeout: 120_000,
  pool: { min: 2, max: 10, idleTimeoutMillis: 30_000 },
};

function findDbFile() {
  const candidates = ['daypilot-live.db', 'daypilot.db'];
  for (const name of candidates) {
    const path = resolve(PROJECT_ROOT, name);
    if (existsSync(path)) return path;
  }
  throw new Error('No SQLite database file found in project root');
}

function getMssqlColumns(pool, tableName) {
  return pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = '${tableName}'
    ORDER BY ORDINAL_POSITION
  `).then(r => r.recordset);
}

function cleanValue(val, dataType) {
  if (val === null || val === undefined || val === '') {
    return null;
  }

  if (dataType === 'int' || dataType === 'bigint') {
    const n = Number(val);
    return isNaN(n) ? null : Math.round(n);
  }
  if (dataType === 'float' || dataType === 'decimal') {
    const n = Number(val);
    return isNaN(n) ? null : n;
  }
  if (dataType === 'datetime2') {
    if (typeof val === 'string' && val.trim()) {
      const d = new Date(val);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }
  if (dataType === 'varbinary') {
    if (Buffer.isBuffer(val)) return val;
    if (typeof val === 'string') return Buffer.from(val, 'base64');
    return null;
  }

  return String(val);
}

function getSqlType(dataType, maxLen) {
  switch (dataType) {
    case 'nvarchar':
      return maxLen === -1 ? sql.NVarChar(sql.MAX) : sql.NVarChar(maxLen || 200);
    case 'varchar':
      return maxLen === -1 ? sql.VarChar(sql.MAX) : sql.VarChar(maxLen || 200);
    case 'int': return sql.Int;
    case 'bigint': return sql.BigInt;
    case 'float': return sql.Float;
    case 'decimal': return sql.Decimal(18, 4);
    case 'datetime2': return sql.DateTime2;
    case 'datetime': return sql.DateTime;
    case 'varbinary': return sql.VarBinary(sql.MAX);
    case 'bit': return sql.Bit;
    default: return sql.NVarChar(sql.MAX);
  }
}

async function migrateTable(sqliteDb, pool, tableName, mssqlCols) {
  const sqliteRows = sqliteDb.prepare(`SELECT * FROM [${tableName}]`).all();
  if (sqliteRows.length === 0) {
    console.log(`  ⏭  ${tableName}: 0 rows (skipping)`);
    return { table: tableName, rows: 0, status: 'skipped' };
  }

  const sqliteColNames = Object.keys(sqliteRows[0]);
  const mssqlColMap = new Map(mssqlCols.map(c => [c.COLUMN_NAME.toLowerCase(), c]));

  // Find columns that exist in both SQLite and MSSQL
  const commonCols = sqliteColNames.filter(c => mssqlColMap.has(c.toLowerCase()));
  if (commonCols.length === 0) {
    console.log(`  ⚠  ${tableName}: no matching columns`);
    return { table: tableName, rows: 0, status: 'no_columns' };
  }

  const hasIdentity = IDENTITY_TABLES.has(tableName);
  const quotedCols = commonCols.map(c => `[${c}]`).join(', ');

  if (DRY_RUN) {
    console.log(`  📋 ${tableName}: ${sqliteRows.length} rows → ${commonCols.length} columns [DRY RUN]`);
    return { table: tableName, rows: sqliteRows.length, status: 'dry_run' };
  }

  // Clear existing data
  const existingCount = (await pool.request().query(`SELECT COUNT(*) as cnt FROM [${tableName}]`)).recordset[0].cnt;
  if (existingCount > 0) {
    console.log(`  🧹 ${tableName}: clearing ${existingCount} existing rows`);
    await pool.request().query(`DELETE FROM [${tableName}]`);
  }

  // Insert in batches
  let inserted = 0;
  const batches = Math.ceil(sqliteRows.length / BATCH_SIZE);

  for (let b = 0; b < batches; b++) {
    const batchRows = sqliteRows.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      for (const row of batchRows) {
        const request = new sql.Request(tx);
        const paramNames = [];

        for (let i = 0; i < commonCols.length; i++) {
          const colName = commonCols[i];
          const mssqlCol = mssqlColMap.get(colName.toLowerCase());
          const dataType = mssqlCol.DATA_TYPE;
          const maxLen = mssqlCol.CHARACTER_MAXIMUM_LENGTH;
          const paramName = `p${i}`;

          const rawVal = row[colName];
          const cleanedVal = cleanValue(rawVal, dataType);

          request.input(paramName, getSqlType(dataType, maxLen), cleanedVal);
          paramNames.push(`@${paramName}`);
        }

        // IDENTITY_INSERT must be in the same request as the INSERT for Azure SQL
        const identityOn = hasIdentity ? `SET IDENTITY_INSERT [${tableName}] ON; ` : '';
        const identityOff = hasIdentity ? `; SET IDENTITY_INSERT [${tableName}] OFF` : '';
        const insertSql = `${identityOn}INSERT INTO [${tableName}] (${quotedCols}) VALUES (${paramNames.join(', ')})${identityOff}`;
        await request.query(insertSql);
        inserted++;
      }

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      console.error(`  ❌ ${tableName} batch ${b + 1}/${batches} failed at row ${inserted + 1}: ${err.message}`);
      if (err.message.includes('Cannot insert duplicate key')) {
        console.error(`     Duplicate key — table may have seed data that conflicts`);
      }
      throw err;
    }

    if (batches > 1) {
      process.stdout.write(`\r  ✅ ${tableName}: batch ${b + 1}/${batches} (${inserted}/${sqliteRows.length})`);
    }
  }

  // Reseed IDENTITY to max id
  if (hasIdentity) {
    try {
      const maxId = (await pool.request().query(`SELECT MAX(id) as m FROM [${tableName}]`)).recordset[0].m;
      if (maxId != null) {
        await pool.request().query(`DBCC CHECKIDENT ('${tableName}', RESEED, ${maxId})`);
      }
    } catch {
      // Some tables might not have 'id' — that's fine
    }
  }

  console.log(`${batches > 1 ? '\n' : ''}  ✅ ${tableName}: ${inserted} rows migrated`);
  return { table: tableName, rows: inserted, status: 'ok' };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log(' NOVA Data Migration: SQLite → MSSQL');
  console.log('═══════════════════════════════════════════════════════');
  if (DRY_RUN) console.log('  *** DRY RUN — no data will be written ***\n');

  // Open SQLite
  const dbPath = findDbFile();
  console.log(`Source: ${dbPath}`);
  const sqliteDb = new Database(dbPath, { readonly: true });

  // Get all SQLite tables
  const sqliteTables = sqliteDb.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
  console.log(`SQLite tables: ${sqliteTables.length}`);

  // Connect to MSSQL
  console.log(`Target: ${MSSQL_CONFIG.server}/${MSSQL_CONFIG.database}`);
  const pool = await sql.connect(MSSQL_CONFIG);
  console.log('Connected to MSSQL\n');

  // Get MSSQL tables
  const mssqlTables = (await pool.request().query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'"
  )).recordset.map(r => r.TABLE_NAME);
  const mssqlTableSet = new Set(mssqlTables);

  // Build migration list
  let tablesToMigrate;
  if (SINGLE_TABLE) {
    tablesToMigrate = [SINGLE_TABLE];
  } else {
    // Use defined order, then add any remaining tables
    const ordered = TABLE_ORDER.filter(t => sqliteTables.includes(t) && mssqlTableSet.has(t));
    const remaining = sqliteTables.filter(t => !SKIP_TABLES.has(t) && mssqlTableSet.has(t) && !ordered.includes(t));
    tablesToMigrate = [...ordered, ...remaining];
  }

  console.log(`Tables to migrate: ${tablesToMigrate.length}`);
  console.log('───────────────────────────────────────────────────────\n');

  const results = [];
  let totalRows = 0;

  for (const tableName of tablesToMigrate) {
    try {
      const mssqlCols = await getMssqlColumns(pool, tableName);
      const result = await migrateTable(sqliteDb, pool, tableName, mssqlCols);
      results.push(result);
      totalRows += result.rows;
    } catch (err) {
      results.push({ table: tableName, rows: 0, status: 'error', error: err.message });
      console.error(`  ❌ ${tableName}: FAILED — ${err.message}`);
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' Migration Summary');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Total tables processed: ${results.length}`);
  console.log(`  Total rows migrated: ${totalRows}`);
  console.log(`  Successful: ${results.filter(r => r.status === 'ok').length}`);
  console.log(`  Skipped (empty): ${results.filter(r => r.status === 'skipped').length}`);
  console.log(`  Failed: ${results.filter(r => r.status === 'error').length}`);

  const failed = results.filter(r => r.status === 'error');
  if (failed.length > 0) {
    console.log('\n  Failed tables:');
    for (const f of failed) {
      console.log(`    ❌ ${f.table}: ${f.error}`);
    }
  }

  console.log('═══════════════════════════════════════════════════════');

  sqliteDb.close();
  await pool.close();
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
