import { useAppBootstrap } from './hooks/useAppBootstrap';
import { EmployeeRegisterStateProvider } from './state/EmployeeRegisterStateProvider';
import { SessionRoot } from '../features/session/SessionRoot';
import { NavigationRoot } from '../features/navigation/NavigationRoot';
import { ModalsRoot } from '../features/modals/ModalsRoot';
import { PaymentRoot } from '../features/payment/PaymentRoot';
import { NotificationsRoot } from '../features/notifications/NotificationsRoot';

export function AppComposition() {
  useAppBootstrap();

  return (
    <EmployeeRegisterStateProvider>
      <SessionRoot>
        <>
          <div className="container">
            <NotificationsRoot />
            <NavigationRoot />
            <ModalsRoot />
            <PaymentRoot />
          </div>
        </>
      </SessionRoot>
    </EmployeeRegisterStateProvider>
  );
}
