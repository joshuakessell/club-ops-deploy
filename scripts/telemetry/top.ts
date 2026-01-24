import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, tsSlug, getArg, defaultArtifactsDir } from './_util';

function normalizeMessage(msg: string) {
  return msg
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      '<uuid>'
    )
    .replace(/\b\d{3,}\b/g, '<n>')
    .trim();
}

function stackHint(stack?: string) {
  if (!stack) return '';
  const line = stack
    .split('\n')
    .find((l) => l.includes('.ts') || l.includes('.tsx') || l.includes('.js'));
  return line ? line.trim() : '';
}

async function fetchEventsFromApi() {
  const baseUrl = getArg('--baseUrl') ?? 'http://localhost:5175';
  const app = getArg('--app');
  const level = getArg('--level');
  const kind = getArg('--kind');
  const deviceId = getArg('--deviceId');
  const sessionId = getArg('--sessionId');
  const since = getArg('--since') ?? '30m';
  const order = (getArg('--order') ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const limit = Number(getArg('--limit') ?? 5000);

  const params = new URLSearchParams();
  if (app) params.set('app', app);
  if (level) params.set('level', level);
  if (kind) params.set('kind', kind);
  if (deviceId) params.set('deviceId', deviceId);
  if (sessionId) params.set('sessionId', sessionId);
  if (since) params.set('since', since);
  params.set('order', order);
  params.set('limit', String(limit));

  let offset = 0;
  const all: any[] = [];
  while (true) {
    const p = new URLSearchParams(params);
    p.set('offset', String(offset));
    p.set('limit', String(Math.max(1, Math.min(1000, limit - all.length))));
    const url = `${baseUrl}/api/v1/telemetry?${p.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { events?: any[] };
    const events = Array.isArray(data.events) ? data.events : [];
    all.push(...events);
    if (events.length === 0) break;
    if (all.length >= limit) break;
    offset += events.length;
  }
  return all;
}

async function main() {
  const input = getArg('--in'); // exported json (optional)
  const onlyLevel = getArg('--onlyLevel') ?? getArg('--level'); // optional post-filter for file mode
  const topN = Number(getArg('--top') ?? 50);

  let events: any[];
  let inputLabel: string;

  if (input) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8')) as any;
    events = (raw?.events as any[]) ?? raw ?? [];
    inputLabel = path.resolve(input);
  } else {
    events = await fetchEventsFromApi();
    inputLabel = '(fetched from API)';
  }

  const map = new Map<string, any>();
  for (const e of events) {
    if (onlyLevel && e?.level !== onlyLevel) continue;

    const msg = normalizeMessage(String(e?.message ?? '(no message)'));
    const key = `${e?.app ?? ''}||${e?.kind ?? ''}||${msg}`;

    const cur =
      map.get(key) ??
      ({
        app: e?.app,
        kind: e?.kind,
        message: msg,
        occurrences: 0,
        lastSeen: e?.ts,
        sampleRoute: e?.route ?? '',
        sampleStack: stackHint(e?.stack),
      } as any);

    cur.occurrences += 1;
    if (!cur.lastSeen || (e?.ts && String(e.ts) > String(cur.lastSeen))) cur.lastSeen = e.ts;
    if (!cur.sampleRoute && e?.route) cur.sampleRoute = e.route;
    if (!cur.sampleStack && e?.stack) cur.sampleStack = stackHint(e.stack);

    map.set(key, cur);
  }

  const rows = Array.from(map.values()).sort((a, b) => {
    if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
    return String(b.lastSeen).localeCompare(String(a.lastSeen));
  });

  const dir = defaultArtifactsDir();
  ensureDir(dir);
  const outPath = path.resolve(getArg('--out') ?? path.join(dir, `top.${tsSlug()}.md`));

  const lines: string[] = [];
  lines.push(`# Telemetry Top Clusters`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Input: ${inputLabel}`);
  lines.push(``);
  lines.push(`| occurrences | last_seen | app | kind | message | sample_route | sample_stack |`);
  lines.push(`|---:|---|---|---|---|---|---|`);

  for (const r of rows.slice(0, Math.max(1, topN))) {
    const msg = String(r.message ?? '').replace(/\|/g, '\\|');
    const route = String(r.sampleRoute ?? '').replace(/\|/g, '\\|');
    const st = String(r.sampleStack ?? '').replace(/\|/g, '\\|');
    lines.push(
      `| ${r.occurrences} | ${r.lastSeen ?? ''} | ${r.app ?? ''} | ${r.kind ?? ''} | ${msg} | ${route} | ${st} |`
    );
  }

  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
