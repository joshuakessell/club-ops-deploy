const { spawn } = require('node:child_process');

const API_URL = process.env.API_HEALTH_URL || 'http://localhost:3000/health';
const MAX_ATTEMPTS = Number(process.env.API_WAIT_ATTEMPTS || 120);
const WAIT_MS = Number(process.env.API_WAIT_MS || 500);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForApi() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(API_URL, { method: 'GET' });
      if (res.ok) return true;
    } catch {
      // ignore and retry
    }
    await sleep(WAIT_MS);
  }
  return false;
}

function spawnProcess(label, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`[start] ${label} exited with signal ${signal}`);
      process.exit(1);
    }
    if (code && code !== 0) {
      console.log(`[start] ${label} exited with code ${code}`);
      process.exit(code);
    }
  });
  return child;
}

async function main() {
  const api = spawnProcess('api', 'pnpm', ['--filter', '@club-ops/api', 'dev'], {
    DEMO_MODE: 'true',
  });

  const ready = await waitForApi();
  if (!ready) {
    console.error(`[start] API did not become ready at ${API_URL}`);
    api.kill('SIGTERM');
    process.exit(1);
  }

  const ui = spawnProcess(
    'ui',
    'pnpm',
    [
      'turbo',
      'run',
      'dev',
      '--filter=@club-ops/customer-kiosk',
      '--filter=@club-ops/employee-register',
      '--filter=@club-ops/office-dashboard',
    ],
    { DEMO_MODE: 'true' }
  );

  const shutdown = () => {
    api.kill('SIGTERM');
    ui.kill('SIGTERM');
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[start] failed:', err);
  process.exit(1);
});
