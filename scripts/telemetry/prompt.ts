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

function preview(s?: string, n = 600) {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n) + `…(truncated ${s.length - n})`;
}

async function main() {
  const input = getArg('--in');
  if (!input)
    throw new Error(`Missing --in <exported.json>. Run: pnpm telemetry:export --format json`);

  const raw = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8')) as any;
  const events: any[] = (raw?.events as any[]) ?? raw ?? [];

  const clusters = new Map<string, any[]>();
  for (const e of events) {
    const msg = normalizeMessage(String(e?.message ?? '(no message)'));
    const key = `${e?.app ?? ''}||${e?.kind ?? ''}||${msg}`;
    const arr = clusters.get(key) ?? [];
    arr.push(e);
    clusters.set(key, arr);
  }

  const ranked = Array.from(clusters.entries())
    .map(([key, arr]) => {
      const lastSeen = arr.reduce((m, e) => (e?.ts && String(e.ts) > String(m) ? e.ts : m), '');
      const [app, kind, message] = key.split('||');
      return {
        key,
        app,
        kind,
        message,
        occurrences: arr.length,
        lastSeen,
        examples: arr
          .sort((a, b) => String(b?.ts ?? '').localeCompare(String(a?.ts ?? '')))
          .slice(0, 10),
      };
    })
    .sort((a, b) =>
      b.occurrences !== a.occurrences
        ? b.occurrences - a.occurrences
        : String(b.lastSeen).localeCompare(String(a.lastSeen))
    );

  const dir = defaultArtifactsDir();
  ensureDir(dir);
  const outPath = path.resolve(getArg('--out') ?? path.join(dir, `prompts.${tsSlug()}.md`));

  const out: string[] = [];
  out.push(`# Cursor Fix Prompts (Telemetry Clusters)`);
  out.push(`Generated: ${new Date().toISOString()}`);
  out.push(`Input: ${path.resolve(input)}`);
  out.push(``);

  const maxClusters = Number(getArg('--top') ?? 15);
  for (const c of ranked.slice(0, Math.max(1, maxClusters))) {
    out.push(`---`);
    out.push(`## Cluster`);
    out.push(`- app: ${c.app}`);
    out.push(`- kind: ${c.kind}`);
    out.push(`- message: ${c.message}`);
    out.push(`- occurrences: ${c.occurrences}`);
    out.push(`- last_seen: ${c.lastSeen}`);
    out.push(``);
    out.push(`### Paste into Cursor`);
    out.push('```md');
    out.push(`You are fixing ONE error cluster. Do not refactor unrelated code.`);
    out.push(``);
    out.push(`Error cluster:`);
    out.push(`- app: ${c.app}`);
    out.push(`- kind: ${c.kind}`);
    out.push(`- message: "${c.message}"`);
    out.push(`- occurrences: ${c.occurrences}`);
    out.push(`- last_seen: ${c.lastSeen}`);
    out.push(``);
    out.push(`Examples (latest 10):`);
    for (const e of c.examples) {
      out.push(`- ts: ${e?.ts ?? ''} route: ${e?.route ?? ''}`);
      out.push(`  message: ${preview(String(e?.message ?? ''), 400)}`);
      if (e?.stack) out.push(`  stack: ${preview(String(e.stack), 600).replace(/\n/g, ' | ')}`);
      if (e?.payload) out.push(`  payload: ${preview(JSON.stringify(e.payload), 600)}`);
    }
    out.push(``);
    out.push(`Tasks:`);
    out.push(`1) Find the code path that triggers this error and identify the root cause.`);
    out.push(
      `2) Fix it with minimal changes and add defensive handling so it cannot recur silently.`
    );
    out.push(
      `3) Ensure telemetry logging remains useful: include requestId, status, and relevant identifiers in payload.`
    );
    out.push(`4) Add a reproducible note or small test to prevent regression.`);
    out.push(``);
    out.push(`Acceptance criteria:`);
    out.push(
      `- After reproducing this flow 10 times, this exact cluster does not appear again in telemetry for the last 30 minutes.`
    );
    out.push(`- No new higher-severity errors are introduced.`);
    out.push('```');
    out.push(``);
  }

  fs.writeFileSync(outPath, out.join('\n'), 'utf8');
  console.log(outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
