import { join } from 'node:path';
import pg, { type QueryConfig } from 'pg';
import { runner } from 'node-pg-migrate';

import { loadDatabaseConfig } from '../src/db/index';
import { loadEnvFromDotEnvIfPresent } from '../src/env/loadEnv';

loadEnvFromDotEnvIfPresent();

const MIGRATIONS_TABLE = 'schema_migrations';
const MIGRATIONS_SCHEMA = 'public';
// Assumption: scripts run from the API package root (services/api).
const MIGRATIONS_DIR = join(process.cwd(), 'migrations');
const BASELINE_MIGRATION_NAME = '000_baseline';
const INCLUDE_BASELINE_ENV = process.env.PGMIGRATE_INCLUDE_BASELINE === '1';

// node-pg-migrate hardcodes run_on; our canonical schema uses executed_at.
const RUN_ON_COLUMN = 'run_on';
const EXECUTED_AT_COLUMN = 'executed_at';

const migrationsTableRegex = new RegExp(`\\b${MIGRATIONS_TABLE}\\b`, 'i');
const createTableRegex = new RegExp(`^\\s*CREATE\\s+TABLE\\s+.*${MIGRATIONS_TABLE}`, 'i');

function rewriteMigrationsSql(sql: string): string {
  if (!migrationsTableRegex.test(sql)) return sql;

  if (createTableRegex.test(sql)) {
    // Keep the migrations table aligned with db/schema.sql (executed_at + default NOW()).
    return `CREATE TABLE "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      ${EXECUTED_AT_COLUMN} TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  }

  if (!sql.includes(RUN_ON_COLUMN)) return sql;
  return sql.replace(/\brun_on\b/g, EXECUTED_AT_COLUMN);
}

function patchQueryText(queryTextOrConfig: string | QueryConfig): string | QueryConfig {
  if (typeof queryTextOrConfig === 'string') {
    return rewriteMigrationsSql(queryTextOrConfig);
  }

  if (!queryTextOrConfig.text) return queryTextOrConfig;

  return {
    ...queryTextOrConfig,
    text: rewriteMigrationsSql(queryTextOrConfig.text),
  };
}

async function ensureBaselineRecorded(client: pg.Client): Promise<void> {
  const tableCheck = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = $2
    ) AS exists`,
    [MIGRATIONS_SCHEMA, MIGRATIONS_TABLE]
  );

  if (!tableCheck.rows[0]?.exists) return;

  const rows = await client.query<{ name: string; executed_at: Date | string }>(
    `SELECT name, ${EXECUTED_AT_COLUMN} AS executed_at FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`
  );

  if (rows.rows.length === 0) return;

  const toDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));
  const executedAtValues = rows.rows
    .map((row) => row.executed_at)
    .filter((value): value is Date | string => Boolean(value))
    .map(toDate);

  if (executedAtValues.length === 0) return;

  const earliestExecutedAt = executedAtValues.reduce((min, current) =>
    current.getTime() < min.getTime() ? current : min
  );
  const baselineExecutedAt = new Date(earliestExecutedAt.getTime() - 1000);

  const baselineRow = rows.rows.find((row) => row.name === BASELINE_MIGRATION_NAME);

  if (!baselineRow) {
    await client.query(
      `INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (name, ${EXECUTED_AT_COLUMN})
       VALUES ($1, $2)
       ON CONFLICT (name) DO NOTHING`,
      [BASELINE_MIGRATION_NAME, baselineExecutedAt]
    );
    return;
  }

  const baselineRowTime = toDate(baselineRow.executed_at).getTime();
  if (baselineRowTime <= baselineExecutedAt.getTime()) return;

  await client.query(
    `UPDATE "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"
     SET ${EXECUTED_AT_COLUMN} = $2
     WHERE name = $1`,
    [BASELINE_MIGRATION_NAME, baselineExecutedAt]
  );
}

async function run(direction: 'up' | 'down'): Promise<void> {
  const config = loadDatabaseConfig();

  if (config.connectionString) {
    if (config.host && typeof config.port === 'number' && config.database) {
      console.log(
        `Connecting to database (DATABASE_URL): ${config.host}:${config.port}/${config.database}`
      );
    } else {
      console.log('Connecting to database (DATABASE_URL): [connection string provided]');
    }
  } else {
    console.log(`Connecting to database (DB_*): ${config.host}:${config.port}/${config.database}`);
  }

  const client = new pg.Client(config);
  const originalQuery = client.query.bind(client);

  client.query = ((queryTextOrConfig: string | QueryConfig, values?: unknown[]) =>
    originalQuery(patchQueryText(queryTextOrConfig) as string | QueryConfig, values)) as typeof client.query;

  await client.connect();

  try {
    await ensureBaselineRecorded(client);
    const ignorePattern = INCLUDE_BASELINE_ENV
      ? '(?!(?:000_baseline\\.sql$|.*__baseline_schema.*)).*'
      : '.*__baseline_schema.*';
    const logger = {
      ...console,
      error: (message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith("Can't determine timestamp for")) {
          return;
        }
        console.error(message, ...args);
      },
    };
    await runner({
      dbClient: client,
      dir: MIGRATIONS_DIR,
      direction,
      ignorePattern,
      logger,
      // Assumption: schema_migrations lives in the public schema per db/schema.sql.
      migrationsTable: MIGRATIONS_TABLE,
      migrationsSchema: MIGRATIONS_SCHEMA,
      schema: MIGRATIONS_SCHEMA,
      checkOrder: true,
      // Match previous behavior: wrap each migration in its own transaction.
      singleTransaction: false,
      createSchema: false,
      createMigrationsSchema: false,
    });
  } finally {
    await client.end();
  }
}

const command = process.argv[2] ?? 'up';
if (command !== 'up' && command !== 'down') {
  console.log('Usage: migrate [up|down]');
  console.log('  Use `pnpm db:migrate:status` for status checks.');
  process.exit(1);
}

run(command).catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
