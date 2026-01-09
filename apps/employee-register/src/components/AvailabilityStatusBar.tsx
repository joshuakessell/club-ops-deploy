export type AvailabilityType = 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL';

export function AvailabilityStatusBar(props: {
  counts: { lockers?: number; STANDARD?: number; DOUBLE?: number; SPECIAL?: number };
  onOpen: (type: AvailabilityType) => void;
}) {
  const { counts, onOpen } = props;

  const pill = (type: AvailabilityType, label: string, count?: number) => {
    const ready = typeof count === 'number' && Number.isFinite(count);
    const display = ready ? String(count) : '…';
    return (
      <button
        type="button"
        className="availability-pill cs-liquid-button cs-liquid-button--secondary"
        onClick={() => onOpen(type)}
        disabled={!ready}
        aria-disabled={!ready}
      >
        {label}: {display}
      </button>
    );
  };

  return (
    <div className="availability-bar cs-liquid-card" aria-label="Availability">
      {pill('LOCKER', 'Lockers', counts.lockers)}
      {pill('STANDARD', 'Standard', counts.STANDARD)}
      {pill('DOUBLE', 'Double', counts.DOUBLE)}
      {pill('SPECIAL', 'Special', counts.SPECIAL)}
    </div>
  );
}


