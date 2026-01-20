export type InventorySummarySection = 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL';

export type InventoryAvailableCounts = null | {
  rooms: Record<string, number>;
  rawRooms: Record<string, number>;
  lockers: number;
};

export interface InventorySummaryBarProps {
  counts: InventoryAvailableCounts;
  onOpenInventorySection: (section: InventorySummarySection) => void;
}

function getCount(rec: Record<string, number> | undefined, key: string): number | null {
  const raw = rec?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function formatRatio(x: number | null, y: number | null) {
  const left = x === null ? '—' : String(x);
  const right = y === null ? '—' : String(y);
  return `${left} / ${right}`;
}

export function InventorySummaryBar({ counts, onOpenInventorySection }: InventorySummaryBarProps) {
  const lockers = counts ? (Number.isFinite(counts.lockers) ? counts.lockers : null) : null;

  const xStandard = counts ? getCount(counts.rooms, 'STANDARD') : null;
  const yStandard = counts ? getCount(counts.rawRooms, 'STANDARD') : null;
  const xDouble = counts ? getCount(counts.rooms, 'DOUBLE') : null;
  const yDouble = counts ? getCount(counts.rawRooms, 'DOUBLE') : null;
  const xSpecial = counts ? getCount(counts.rooms, 'SPECIAL') : null;
  const ySpecial = counts ? getCount(counts.rawRooms, 'SPECIAL') : null;

  const disabled = !counts;

  const Button = (props: {
    label: string;
    ratio: string;
    section: InventorySummarySection;
  }) => (
    <button
      type="button"
      className="cs-liquid-button cs-liquid-button--secondary cs-liquid-button--pill"
      style={{
        padding: '0.55rem 0.85rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: '0.75rem',
        width: '100%',
        textAlign: 'left',
        opacity: disabled ? 0.65 : 1,
      }}
      disabled={disabled}
      onClick={() => onOpenInventorySection(props.section)}
    >
      <span style={{ fontWeight: 800 }}>{props.label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, marginLeft: 'auto' }}>
        {props.ratio}
      </span>
    </button>
  );

  return (
    <div
      className="cs-liquid-card"
      style={{
        padding: '0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        alignItems: 'stretch',
      }}
      aria-label="Inventory summary"
    >
      <Button label="Lockers" ratio={formatRatio(lockers, lockers)} section="LOCKER" />
      <Button label="Standard" ratio={formatRatio(xStandard, yStandard)} section="STANDARD" />
      <Button label="Double" ratio={formatRatio(xDouble, yDouble)} section="DOUBLE" />
      <Button label="Special" ratio={formatRatio(xSpecial, ySpecial)} section="SPECIAL" />
    </div>
  );
}


