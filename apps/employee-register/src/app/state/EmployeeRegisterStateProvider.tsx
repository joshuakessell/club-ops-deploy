import { type ReactNode } from 'react';
import { EmployeeRegisterStateContext } from './EmployeeRegisterStateContext';
import { useEmployeeRegisterStateValue } from './useEmployeeRegisterStateValue';

export type EmployeeRegisterStateValue = ReturnType<typeof useEmployeeRegisterStateValue>;

export function EmployeeRegisterStateProvider({ children }: { children: ReactNode }) {
  const value = useEmployeeRegisterStateValue();
  return (
    <EmployeeRegisterStateContext.Provider value={value}>
      {children}
    </EmployeeRegisterStateContext.Provider>
  );
}
