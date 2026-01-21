import { spawn } from 'node:child_process';

function run(cmd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, {
      stdio: 'inherit',
      shell: true,
      env: process.env,
    });

    child.on('exit', (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`Command failed (${code ?? signal}): ${cmd}`));
    });
  });
}

// Demo runner: wipe DB, reseed, then start all dev servers via Turborepo.
async function main() {
  // Force demo behavior for everything launched by this script.
  process.env.DEMO_MODE = 'true';
  process.env.SKIP_DB = 'false';
  process.env.SEED_ON_STARTUP = 'false';

  // API refuses to start without this. Use an override if you already export one.
  if (!process.env.KIOSK_TOKEN || !process.env.KIOSK_TOKEN.trim()) {
    process.env.KIOSK_TOKEN = 'demo-token';
  }

  console.log('\n[demo] DEMO_MODE=true SKIP_DB=false SEED_ON_STARTUP=false');
  console.log(`[demo] KIOSK_TOKEN=${process.env.KIOSK_TOKEN ? '<set>' : '<missing>'}\n`);

  // Reset database volume + restart container
  await run('pnpm exec turbo run db:reset --filter=@club-ops/api');

  // Apply schema + seed base + seed demo dataset
  await run('pnpm exec turbo run db:migrate --filter=@club-ops/api');
  await run('pnpm exec turbo run seed --filter=@club-ops/api');
  await run('pnpm exec turbo run seed:demo --filter=@club-ops/api');

  // Ensure all dev ports are free before starting servers
  await run('pnpm kill-ports');

  // Start API + all apps (via Turbo)
  await run(
    [
      'pnpm exec turbo run dev --parallel',
      '--filter=@club-ops/api',
      '--filter=@club-ops/customer-kiosk',
      '--filter=@club-ops/employee-register',
      '--filter=@club-ops/office-dashboard',
      '--filter=@club-ops/cleaning-station-kiosk',
      '--filter=@club-ops/checkout-kiosk',
    ].join(' ')
  );
}

main().catch((err) => {
  console.error('\n[demo] Failed:', err.message);
  process.exit(1);
});

