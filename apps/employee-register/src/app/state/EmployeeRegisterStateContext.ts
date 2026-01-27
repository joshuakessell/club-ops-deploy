import { createContext } from 'react';
import type { EmployeeRegisterStateValue } from './EmployeeRegisterStateProvider';

export const EmployeeRegisterStateContext = createContext<EmployeeRegisterStateValue | null>(null);
