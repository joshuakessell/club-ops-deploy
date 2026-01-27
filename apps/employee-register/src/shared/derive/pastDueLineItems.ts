type LineItem = { description: string; amount: number };

export function derivePastDueLineItems(
  customerNotes: string | undefined,
  pastDueBalance: number
): LineItem[] {
  const items: LineItem[] = [];
  const notes = customerNotes || '';
  for (const line of notes.split('\n')) {
    const m = line.match(
      /^\[SYSTEM_LATE_FEE_PENDING\]\s+Late fee\s+\(\$(\d+(?:\.\d{2})?)\):\s+customer was\s+(.+)\s+late on last visit on\s+(\d{4}-\d{2}-\d{2})\./
    );
    if (!m) continue;
    const amount = Number.parseFloat(m[1]!);
    const dur = m[2]!.trim();
    const date = m[3]!;
    if (!Number.isFinite(amount)) continue;
    items.push({
      description: `Late fee (last visit ${date}, ${dur} late)`,
      amount,
    });
  }

  if (items.length === 0 && pastDueBalance > 0) {
    items.push({ description: 'Past due balance', amount: pastDueBalance });
  }

  return items;
}
