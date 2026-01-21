import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { loadDatabaseConfig } from './index';
import { loadEnvFromDotEnvIfPresent } from '../env/loadEnv';

loadEnvFromDotEnvIfPresent();

const MIGRATIONS_TABLE = 'schema_migrations';

interface Migration {
  id: number;
  name: string;
  filename: string;
  sql: string;
}

/**
 * Ensure the migrations tracking table exists.
 */
async function ensureMigrationsTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Get list of already executed migrations.
 */
async function getExecutedMigrations(client: pg.PoolClient): Promise<Set<string>> {
  const result = await client.query<{ name: string }>(
    `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY id`
  );
  return new Set(result.rows.map((row) => row.name));
}

/**
 * Load migration files from the migrations directory.
 */
async function loadMigrations(): Promise<Migration[]> {
  const migrationsDir = join(__dirname, '../../migrations');
  const files = await readdir(migrationsDir);

  const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort(); // Ensure alphabetical order

  const migrations: Migration[] = [];

  for (const filename of sqlFiles) {
    const match = filename.match(/^(\d+)_(.+)\.sql$/);
    if (!match) {
      console.warn(`Skipping invalid migration filename: ${filename}`);
      continue;
    }

    const idStr = match[1];
    const sql = await readFile(join(migrationsDir, filename), 'utf-8');

    migrations.push({
      id: parseInt(idStr!, 10),
      name: filename.replace('.sql', ''),
      filename,
      sql,
    });
  }

  return migrations;
}

/**
 * Run all pending migrations.
 */
export async function runMigrations(): Promise<void> {
  const config = loadDatabaseConfig();
  const pool = new pg.Pool(config);

  console.log(`Connecting to database: ${config.host}:${config.port}/${config.database}`);

  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);

    const executedMigrations = await getExecutedMigrations(client);
    const migrations = await loadMigrations();

    const pendingMigrations = migrations.filter((m) => !executedMigrations.has(m.name));

    if (pendingMigrations.length === 0) {
      console.log('No pending migrations');
      return;
    }

    console.log(`Found ${pendingMigrations.length} pending migration(s)`);

    for (const migration of pendingMigrations) {
      console.log(`Running migration: ${migration.filename}`);

      await client.query('BEGIN');

      try {
        await client.query(migration.sql);
        await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1)`, [migration.name]);
        await client.query('COMMIT');
        console.log(`  ✓ ${migration.filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`  ✗ ${migration.filename} failed:`, error);
        throw error;
      }
    }

    console.log('All migrations completed successfully');
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Rollback the last migration (for development use).
 */
export async function rollbackLastMigration(): Promise<void> {
  const config = loadDatabaseConfig();
  const pool = new pg.Pool(config);

  const client = await pool.connect();

  try {
    const result = await client.query<{ name: string }>(
      `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY id DESC LIMIT 1`
    );

    if (result.rows.length === 0) {
      console.log('No migrations to rollback');
      return;
    }

    const lastMigration = result.rows[0]!.name;
    console.log(`Rolling back: ${lastMigration}`);

    // Note: This only removes the migration record.
    // Actual rollback SQL would need to be implemented per-migration.
    await client.query(`DELETE FROM ${MIGRATIONS_TABLE} WHERE name = $1`, [lastMigration]);

    console.log(`Removed migration record: ${lastMigration}`);
    console.log('Note: Database schema changes were NOT reverted. Manual cleanup may be required.');
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Show migration status.
 */
export async function showMigrationStatus(): Promise<void> {
  const config = loadDatabaseConfig();
  const pool = new pg.Pool(config);

  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);

    const executedMigrations = await getExecutedMigrations(client);
    const migrations = await loadMigrations();

    console.log('\nMigration Status:');
    console.log('─'.repeat(60));

    for (const migration of migrations) {
      const status = executedMigrations.has(migration.name) ? '✓' : '○';
      console.log(`  ${status} ${migration.filename}`);
    }

    console.log('─'.repeat(60));
    console.log(
      `Total: ${migrations.length}, Executed: ${executedMigrations.size}, Pending: ${migrations.length - executedMigrations.size}`
    );
  } finally {
    client.release();
    await pool.end();
  }
}

// CLI entrypoint
const command = process.argv[2];

switch (command) {
  case 'up':
  case 'migrate':
  case undefined:
    runMigrations().catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
    break;

  case 'status':
    showMigrationStatus().catch((err) => {
      console.error('Failed to get status:', err);
      process.exit(1);
    });
    break;

  case 'rollback':
    rollbackLastMigration().catch((err) => {
      console.error('Rollback failed:', err);
      process.exit(1);
    });
    break;

  default:
    console.log('Usage: migrate [command]');
    console.log('');
    console.log('Commands:');
    console.log('  up, migrate   Run pending migrations (default)');
    console.log('  status        Show migration status');
    console.log('  rollback      Rollback last migration record');
    process.exit(1);
}
