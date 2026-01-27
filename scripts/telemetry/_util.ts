import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

export function tsSlug(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function getArg(flag: string) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

export function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

export function defaultArtifactsDir() {
  return path.resolve(process.cwd(), 'artifacts', 'telemetry');
}
