import pg from 'pg';

const { Pool } = pg;

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

function parseDatabaseUrl(urlString: string): {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
} {
  try {
    const url = new URL(urlString);

    // Best-effort support for postgres connection strings used by hosting providers.
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
      return {};
    }

    const host = url.hostname || undefined;
    const port = url.port ? parseInt(url.port, 10) : undefined;
    const databaseFromPath = url.pathname.replace(/^\/+/, '');
    const database = databaseFromPath ? databaseFromPath : undefined;
    const user = url.username || undefined;

    return {
      host,
      port: typeof port === 'number' && !Number.isNaN(port) ? port : undefined,
      database,
      user,
    };
  } catch {
    return {};
  }
}

/**
 * Load database configuration from environment variables.
 */
export function loadDatabaseConfig(): pg.PoolConfig {
  if (process.env.DATABASE_URL) {
    const parsed = parseDatabaseUrl(process.env.DATABASE_URL);
    return {
      connectionString: process.env.DATABASE_URL,
      ...(parsed.host ? { host: parsed.host } : {}),
      ...(typeof parsed.port === 'number' ? { port: parsed.port } : {}),
      ...(parsed.database ? { database: parsed.database } : {}),
      ...(parsed.user ? { user: parsed.user } : {}),
      ssl: {
        rejectUnauthorized: false,
      },
      max: parseInt(process.env.DB_POOL_MAX || '20', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5433', 10),
    database: process.env.DB_NAME || 'club_operations',
    user: process.env.DB_USER || 'clubops',
    password: process.env.DB_PASSWORD || 'clubops_dev',
    ssl: process.env.DB_SSL === 'true',
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
}

let pool: pg.Pool | null = null;

/**
 * Get the shared database connection pool.
 * Creates the pool on first call.
 */
export function getPool(): pg.Pool {
  if (!pool) {
    const config = loadDatabaseConfig();
    pool = new Pool(config);

    // Handle pool errors
    pool.on('error', (err) => {
      console.error('Unexpected error on idle database client', err);
    });
  }
  return pool;
}

/**
 * Initialize the database connection pool.
 * Tests the connection and returns the pool.
 */
export async function initializeDatabase(): Promise<pg.Pool> {
  const dbPool = getPool();

  // Test the connection
  const client = await dbPool.connect();
  try {
    await client.query('SELECT NOW()');
    console.log('Database connection established');
  } finally {
    client.release();
  }

  return dbPool;
}

/**
 * Close the database connection pool.
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('Database connection pool closed');
  }
}

/**
 * Execute a query with automatic client acquisition and release.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const dbPool = getPool();
  const start = Date.now();
  const result = await dbPool.query<T>(text, params);
  const duration = Date.now() - start;

  if (process.env.DB_LOG_QUERIES === 'true') {
    console.log('Executed query', { text, duration, rows: result.rowCount });
  }

  return result;
}

/**
 * Execute a transaction with automatic commit/rollback.
 */
export async function transaction<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const dbPool = getPool();
  const client = await dbPool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Execute a serializable transaction for critical operations like bookings.
 * This provides the highest isolation level to prevent race conditions.
 */
export async function serializableTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const dbPool = getPool();
  const client = await dbPool.connect();

  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export { pg };
