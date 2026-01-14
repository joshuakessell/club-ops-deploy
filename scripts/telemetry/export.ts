import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, tsSlug, getArg, defaultArtifactsDir } from './_util';

function toInt(v: unknown, fallback: number) {
  const n = typeof v === 'string' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

async function main() {
  const baseUrl = getArg('--baseUrl') ?? 'http://localhost:5175';
  const app = getArg('--app');
  const level = getArg('--level');
  const kind = getArg('--kind');
  const deviceId = getArg('--deviceId');
  const sessionId = getArg('--sessionId');
  const since = getArg('--since') ?? '30m';
  const order = (getArg('--order') ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const format = (getArg('--format') ?? 'json').toLowerCase(); // json|ndjson
  const limit = toInt(getArg('--limit'), 1000);
  const outArg = getArg('--out');

  const dir = defaultArtifactsDir();
  ensureDir(dir);

  const nameParts = ['telemetry', tsSlug(), app ?? 'all', level ?? 'all', kind ?? 'all'];
  const ext = format === 'ndjson' ? 'ndjson' : 'json';
  const outPath = outArg ? path.resolve(outArg) : path.join(dir, `${nameParts.join('.')}.${ext}`);
  ensureDir(path.dirname(outPath));

  const params = new URLSearchParams();
  if (app) params.set('app', app);
  if (level) params.set('level', level);
  if (kind) params.set('kind', kind);
  if (deviceId) params.set('deviceId', deviceId);
  if (sessionId) params.set('sessionId', sessionId);
  if (since) params.set('since', since);
  params.set('order', order);
  params.set('limit', String(limit));

  if (format === 'ndjson') {
    const url = `${baseUrl}/api/v1/telemetry/export.ndjson?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`Export failed: ${res.status} ${res.statusText}`);

    const file = fs.createWriteStream(outPath, { encoding: 'utf8' });
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      file.write(Buffer.from(value).toString('utf8'));
    }
    file.end();
    console.log(outPath);
    return;
  }

  // json mode: use paged endpoint
  let offset = 0;
  const all: any[] = [];

  while (true) {
    const pageParams = new URLSearchParams(params);
    pageParams.set('offset', String(offset));
    pageParams.set('limit', String(Math.max(1, Math.min(1000, limit - all.length))));

    const url = `${baseUrl}/api/v1/telemetry?${pageParams.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { events?: any[] };

    const events = Array.isArray(data.events) ? data.events : [];
    all.push(...events);

    if (events.length === 0) break;
    if (all.length >= limit) break;
    offset += events.length;
  }

  const output = {
    exportedAt: new Date().toISOString(),
    baseUrl,
    filters: { app, level, kind, deviceId, sessionId, since, order, limit },
    events: all,
  };

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

