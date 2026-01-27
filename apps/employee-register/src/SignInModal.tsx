import { useState, useEffect } from 'react';
import { LiquidGlassPinInput } from '@club-ops/ui';
import { getApiUrl } from '@club-ops/shared';

const API_BASE = getApiUrl('/api');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const msg = value['message'];
  const err = value['error'];
  if (typeof msg === 'string' && msg.trim()) return msg;
  if (typeof err === 'string' && err.trim()) return err;
  return undefined;
}

async function readJson<T>(response: Response): Promise<T> {
  const data: unknown = await response.json();
  return data as T;
}

interface Employee {
  id: string;
  name: string;
  role: string;
  signedIn: boolean;
  registerNumbers: number[];
}

interface SignInModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSignIn: (data: {
    employeeId: string;
    employeeName: string;
    registerNumber: number;
    deviceId: string;
    pin: string; // PIN needed to create staff session
  }) => void;
  deviceId: string;
}

type SignInStep = 'select-employee' | 'enter-pin' | 'assign-register' | 'confirm';

type RegisterAvailability = {
  registerNumber: 1 | 2;
  occupied: boolean;
  deviceId?: string;
  employee?: {
    id: string;
    name: string;
    role: string;
  };
};

export function SignInModal({ isOpen, onClose, onSignIn, deviceId }: SignInModalProps) {
  const [step, setStep] = useState<SignInStep>('select-employee');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [registerNumber, setRegisterNumber] = useState<number | null>(null);
  const [registers, setRegisters] = useState<RegisterAvailability[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch available employees on open
  useEffect(() => {
    if (isOpen && step === 'select-employee') {
      void fetchAvailableEmployees();
    }
  }, [isOpen, step]);

  const fetchAvailableEmployees = async () => {
    try {
      const response = await fetch(`${API_BASE}/v1/employees/available`);
      if (!response.ok) throw new Error('Failed to fetch employees');
      const data = await readJson<{ employees?: unknown[] }>(response);
      const employees = (Array.isArray(data.employees) ? data.employees : [])
        .filter(isRecord)
        .filter(
          (e) =>
            typeof e.id === 'string' && typeof e.name === 'string' && typeof e.role === 'string'
        )
        .map((e) => ({
          id: e.id as string,
          name: e.name as string,
          role: e.role as string,
          signedIn: Boolean(e.signedIn),
          registerNumbers: Array.isArray(e.registerNumbers)
            ? e.registerNumbers.filter((n) => typeof n === 'number')
            : [],
        }));
      setEmployees(employees);
    } catch (error) {
      console.error('Failed to fetch employees:', error);
      setError('Failed to load employees');
    }
  };

  const fetchRegisterAvailability = async () => {
    try {
      const response = await fetch(`${API_BASE}/v1/registers/availability`);
      if (!response.ok) throw new Error('Failed to fetch register availability');
      const data = await readJson<{ registers?: unknown[] }>(response);
      setRegisters((Array.isArray(data.registers) ? data.registers : []) as RegisterAvailability[]);
    } catch (err) {
      console.error('Failed to fetch register availability:', err);
      setError('Failed to load register availability');
      setRegisters(null);
    }
  };

  const handleSelectEmployee = (employee: Employee) => {
    setSelectedEmployee(employee);
    setStep('enter-pin');
    setPin('');
    setPinError(false);
    setError(null);
  };

  const handlePinSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!selectedEmployee || !pin.trim()) return;

    setIsLoading(true);
    setPinError(false);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/v1/auth/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: selectedEmployee.id,
          pin: pin.trim(),
          deviceId,
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        if (getErrorMessage(errorPayload) === 'Wrong PIN') {
          setPinError(true);
          setPin('');
          // Shake animation will be handled by CSS
          return;
        }
        throw new Error(getErrorMessage(errorPayload) || 'PIN verification failed');
      }

      // PIN verified, allow user to choose a register
      setStep('assign-register');
      await fetchRegisterAvailability();
    } catch (error) {
      console.error('PIN verification error:', error);
      setError(error instanceof Error ? error.message : 'PIN verification failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAssignRegister = async (requestedRegisterNumber?: 1 | 2) => {
    if (!selectedEmployee) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/v1/registers/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: selectedEmployee.id,
          deviceId,
          registerNumber: requestedRegisterNumber,
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to assign register');
      }

      const data = await readJson<{ registerNumber?: number }>(response);

      if (typeof data.registerNumber === 'number') setRegisterNumber(data.registerNumber);
      setStep('confirm');
    } catch (error) {
      console.error('Register assignment error:', error);
      setError(error instanceof Error ? error.message : 'Failed to assign register');
      // Refresh availability in case occupancy changed
      await fetchRegisterAvailability();
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectRegister = async (num: 1 | 2) => {
    await handleAssignRegister(num);
  };

  const handleConfirm = async () => {
    if (!selectedEmployee || !registerNumber) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/v1/registers/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: selectedEmployee.id,
          deviceId,
          registerNumber,
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to confirm register assignment');
      }

      await response.json().catch(() => null);

      // Sign in complete - pass PIN for staff session creation
      onSignIn({
        employeeId: selectedEmployee.id,
        employeeName: selectedEmployee.name,
        registerNumber,
        deviceId,
        pin: pin, // Pass PIN for staff session
      });

      // Reset state
      setStep('select-employee');
      setSelectedEmployee(null);
      setPin('');
      setRegisterNumber(null);
      setPinError(false);
      setError(null);
      onClose();
    } catch (error) {
      console.error('Confirmation error:', error);
      setError(error instanceof Error ? error.message : 'Failed to confirm');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    if (step === 'enter-pin') {
      setStep('select-employee');
      setSelectedEmployee(null);
      setPin('');
      setPinError(false);
    } else if (step === 'assign-register') {
      setStep('enter-pin');
      setRegisterNumber(null);
      setRegisters(null);
    } else if (step === 'confirm') {
      setStep('assign-register');
      setRegisterNumber(null);
    }
    setError(null);
  };

  const formatSignedInLabel = (employee: Employee) => {
    if (!employee.signedIn) return '';
    const registers = employee.registerNumbers.map((num) => `Register ${num}`).join(', ');
    return registers ? ` (Signed in: ${registers})` : ' (Signed in)';
  };

  if (!isOpen) return null;

  return (
    <div className="sign-in-modal-overlay" onClick={onClose}>
      <div className="sign-in-modal cs-liquid-card" onClick={(e) => e.stopPropagation()}>
        <button
          className="sign-in-modal-close cs-liquid-button cs-liquid-button--secondary"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        {step === 'select-employee' && (
          <div className="sign-in-step">
            <h2>Select Employee</h2>
            {error && <div className="sign-in-error">{error}</div>}
            <div className="employee-list">
              {employees.length === 0 ? (
                <p>No employees found</p>
              ) : (
                employees.map((emp) => (
                  <button
                    key={emp.id}
                    className="employee-item cs-liquid-button cs-liquid-button--secondary"
                    onClick={() => handleSelectEmployee(emp)}
                    disabled={isLoading}
                  >
                    {emp.name}
                    {formatSignedInLabel(emp)}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {step === 'enter-pin' && selectedEmployee && (
          <div className="sign-in-step">
            <h2>Enter PIN</h2>
            <p className="sign-in-subtitle">Employee: {selectedEmployee.name}</p>
            {pinError && <div className="sign-in-error shake">Wrong PIN</div>}
            {error && <div className="sign-in-error">{error}</div>}
            <LiquidGlassPinInput
              length={6}
              value={pin}
              onChange={(next) => {
                setPin(next);
                setPinError(false);
              }}
              onSubmit={() => void handlePinSubmit()}
              submitLabel={isLoading ? 'Verifying…' : 'Verify PIN'}
              submitDisabled={isLoading}
              disabled={isLoading}
              className={pinError ? 'shake' : undefined}
              displayAriaLabel="Employee PIN"
            />
            <div className="sign-in-actions">
              <button
                type="button"
                className="cs-liquid-button cs-liquid-button--secondary"
                onClick={handleBack}
                disabled={isLoading}
              >
                Back
              </button>
            </div>
          </div>
        )}

        {step === 'assign-register' && (
          <div className="sign-in-step">
            <h2>Select Register</h2>
            {error && <div className="sign-in-error">{error}</div>}
            {!registers ? (
              <div className="sign-in-subtitle">Loading registers...</div>
            ) : (
              <div className="register-buttons">
                {([1, 2] as const).map((num) => {
                  const reg = registers.find((r) => r.registerNumber === num);
                  const occupied = reg?.occupied ?? false;
                  const occupiedBySelectedEmployee = reg?.employee?.id === selectedEmployee?.id;
                  const occupiedLabel = occupied
                    ? occupiedBySelectedEmployee
                      ? ' (Signed in)'
                      : reg?.employee?.name
                        ? ` (In use: ${reg.employee.name})`
                        : ' (In use)'
                    : '';
                  const disabled = isLoading || occupied;

                  return (
                    <button
                      key={num}
                      className="register-button cs-liquid-button"
                      onClick={() => void handleSelectRegister(num)}
                      disabled={disabled}
                      title={occupied ? `Register ${num} is occupied` : `Use Register ${num}`}
                    >
                      Register {num}
                      {occupiedLabel}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="sign-in-actions">
              <button
                className="cs-liquid-button cs-liquid-button--secondary"
                onClick={handleBack}
                disabled={isLoading}
              >
                Back
              </button>
              <button
                type="button"
                className="cs-liquid-button cs-liquid-button--secondary"
                onClick={() => void fetchRegisterAvailability()}
                disabled={isLoading}
              >
                Refresh
              </button>
            </div>
          </div>
        )}

        {step === 'confirm' && registerNumber && (
          <div className="sign-in-step">
            <h2>Assigned Register {registerNumber}</h2>
            <p className="sign-in-subtitle">Employee: {selectedEmployee?.name}</p>
            {error && <div className="sign-in-error">{error}</div>}
            <div className="sign-in-actions">
              <button
                className="cs-liquid-button cs-liquid-button--secondary"
                onClick={handleBack}
                disabled={isLoading}
              >
                Back
              </button>
              <button
                className="cs-liquid-button"
                onClick={() => void handleConfirm()}
                disabled={isLoading}
              >
                {isLoading ? 'Confirming...' : 'Confirm'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
