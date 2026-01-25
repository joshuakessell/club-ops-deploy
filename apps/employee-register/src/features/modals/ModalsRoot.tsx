import { CustomerModals } from './CustomerModals';
import { UpgradeModals } from './UpgradeModals';
import { MemberSupportModals } from './MemberSupportModals';
import { TransactionModal } from './TransactionModal';
import { DocumentsModal } from './DocumentsModal';

export function ModalsRoot() {
  return (
    <>
      <CustomerModals />
      <UpgradeModals />
      <MemberSupportModals />
      <TransactionModal />
      <DocumentsModal />
    </>
  );
}
