export function parseSince(input?: string): Date | undefined {
  if (!input) return undefined;

  // ISO timestamp
  const asDate = new Date(input);
  if (!Number.isNaN(asDate.getTime()) && input.includes('T')) return asDate;

  // Relative like 30m, 24h, 7d
  const m = input.trim().match(/^(\d+)\s*([mhd])$/i);
  if (!m) return undefined;

  const n = Number(m[1]!);
  const unit = m[2]!.toLowerCase();

  const ms = unit === 'm' ? n * 60_000 : unit === 'h' ? n * 3_600_000 : n * 86_400_000;
  return new Date(Date.now() - ms);
}

