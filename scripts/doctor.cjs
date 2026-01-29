#!/usr/bin/env node
const { execSync } = require('child_process');
const { existsSync } = require('fs');
const { resolve } = require('path');
const net = require('net');

const root = resolve(__dirname, '..');
process.chdir(root);

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', ...opts });
    return true;
  } catch (e) {
    if (!opts.allowFail) process.exit(1);
    return false;
  }
}

function check(file, label) {
  if (existsSync(file)) {
    console.log(`${label} OK`);
  } else {
    console.error(`${label} MISSING`);
    process.exit(1);
  }
}

function checkPortOpen(port, host = '127.0.0.1', timeoutMs = 400) {
  return new Promise((resolvePromise) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (ok) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {}
      resolvePromise(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function main() {
  console.log('== ClubOps Doctor ==');
  console.log(`PWD: ${process.cwd()}\n`);

  console.log('== Tooling ==');
  run('node -v', { allowFail: true });
  run('pnpm -v', { allowFail: true });
  console.log();

  console.log('== Workspace sanity ==');
  check('pnpm-workspace.yaml', 'pnpm-workspace.yaml');
  check('packages/shared/package.json', 'packages/shared/package.json');
  check('services/api/package.json', 'services/api/package.json');
  console.log();

  console.log('== Install deps (idempotent) ==');
  run('pnpm install');
  console.log();

  console.log('== Build shared (needed for dist exports) ==');
  run('pnpm --filter @club-ops/shared build');
  console.log();

  console.log('== Build ui (needed for dist exports) ==');
  run('pnpm --filter @club-ops/ui build');
  console.log();

  console.log('== Run shared tests ==');
  run('pnpm --filter @club-ops/shared test');
  console.log();

  console.log('== Run api tests (requires Postgres) ==');
  const pgUp = await checkPortOpen(5432);
  if (!pgUp) {
    console.log('Postgres not reachable on localhost:5432. Skipping @club-ops/api tests.');
    console.log('To run them locally: pnpm db:start && pnpm db:migrate && pnpm db:seed');
  } else {
    run('pnpm --filter @club-ops/api test');
  }
  console.log();

  console.log('== Typecheck all ==');
  run('pnpm typecheck');
  console.log();

  console.log('== Lint all ==');
  run('pnpm lint');
  console.log();

  console.log('== Build all ==');
  run('pnpm build');
  console.log();

  console.log('== Done ==');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
