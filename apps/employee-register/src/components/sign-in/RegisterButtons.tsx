export type RegisterNumber = 1 | 2 | 3;

export type RegisterAvailability = {
  registerNumber: RegisterNumber;
  occupied: boolean;
  deviceId?: string;
  employee?: {
    id: string;
    name: string;
    role: string;
  };
};

type RegisterButtonsProps = {
  registers: RegisterAvailability[];
  selectedEmployeeId: string | null;
  disabled?: boolean;
  onSelect: (registerNumber: RegisterNumber) => void;
};

const REGISTER_NUMBERS: RegisterNumber[] = [1, 2, 3];

export function RegisterButtons({
  registers,
  selectedEmployeeId,
  disabled = false,
  onSelect,
}: RegisterButtonsProps) {
  return (
    <div className="register-buttons">
      {REGISTER_NUMBERS.map((num) => {
        const reg = registers.find((r) => r.registerNumber === num);
        const occupied = reg?.occupied ?? false;
        const occupiedBySelectedEmployee = Boolean(
          selectedEmployeeId && reg?.employee?.id === selectedEmployeeId
        );
        const occupiedLabel = occupied
          ? occupiedBySelectedEmployee
            ? ' (Signed in)'
            : reg?.employee?.name
              ? ` (In use: ${reg.employee.name})`
              : ' (In use)'
          : '';
        const isDisabled = disabled || (occupied && !occupiedBySelectedEmployee);
        const title = occupied
          ? occupiedBySelectedEmployee
            ? `Resume Register ${num}`
            : `Register ${num} is occupied`
          : `Use Register ${num}`;

        return (
          <button
            key={num}
            className="register-button cs-liquid-button"
            onClick={() => onSelect(num)}
            disabled={isDisabled}
            title={title}
          >
            Register {num}
            {occupiedLabel}
          </button>
        );
      })}
    </div>
  );
}
