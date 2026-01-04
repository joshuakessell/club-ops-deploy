import { Client } from "pg";

const {
  DB_HOST = "localhost",
  DB_PORT = "5433",
  // Keep defaults aligned with `src/db/index.ts` so local dev + tests behave consistently.
  DB_USER = "clubops",
  DB_PASSWORD = "clubops_dev",
  DB_NAME = "club_operations",
} = process.env;

const MAX_RETRIES = 30;
const RETRY_DELAY_MS = 1000;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDb() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const client = new Client({
      host: DB_HOST,
      port: Number(DB_PORT),
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
    });

    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();

      console.log("Database is ready");
      process.exit(0);
    } catch (err) {
      await client.end().catch(() => {});
      console.log(
        `Waiting for database (${attempt}/${MAX_RETRIES})...`
      );
      await sleep(RETRY_DELAY_MS);
    }
  }

  console.error("Database did not become ready in time");
  process.exit(1);
}

waitForDb();
