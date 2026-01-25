import { useContext } from 'react';
import { EmployeeRegisterStateContext } from './EmployeeRegisterStateProvider';

export function useEmployeeRegisterState() {
  const ctx = useContext(EmployeeRegisterStateContext);
  if (!ctx) {
    throw new Error('useEmployeeRegisterState must be used within EmployeeRegisterStateProvider');
  }
  return ctx;
}
