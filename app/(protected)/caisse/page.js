import { randomUUID } from 'node:crypto';

import { getUserPermissions } from '../../../lib/access.js';
import {
  CASH_PAYMENT_FORM_PERMISSIONS,
  listCashJournalFilterOptions,
  listCashPayments,
  listCashRemainders,
  readCashJournalState,
  readCashRemaindersState,
} from '../../../lib/cash-payments.js';
import {
  CASH_WITHDRAWAL_FORM_PERMISSIONS,
  getCashWithdrawalPreviewData,
  getTrackedCashBalance,
} from '../../../lib/cash-withdrawals.js';
import { requirePermission } from '../../../lib/sessions.js';
import CashJournal from './cash-journal.js';
import CashRemainders from './cash-remainders.js';
import CashWorkspace from './cash-workspace.js';
import { readCashView, formatCashSignedAmount } from '../../../lib/cash-navigation.js';
import styles from './cash.module.css';

export const metadata = {
  title: 'Caisse | Syphax',
};

const CashPage = async ({ searchParams }) => {
  const session = await requirePermission('cash.read');
  const resolvedSearchParams = await searchParams;
  const view = readCashView(resolvedSearchParams.vue);
  const listState = readCashJournalState(resolvedSearchParams);
  const remainderState = readCashRemaindersState(resolvedSearchParams);
  const permissions = await getUserPermissions(session.userId);
  const canPreviewWithdrawal = CASH_WITHDRAWAL_FORM_PERMISSIONS.every(
    (permission) => permissions.includes(permission),
  );
  const [
    journal,
    options,
    remainders,
    trackedBalance,
    withdrawalPreview,
  ] = await Promise.all([
    listCashPayments({ ...listState, userId: session.userId }),
    listCashJournalFilterOptions({ userId: session.userId }),
    listCashRemainders({ ...remainderState, userId: session.userId }),
    getTrackedCashBalance({ userId: session.userId }),
    canPreviewWithdrawal
      ? getCashWithdrawalPreviewData({ userId: session.userId })
      : null,
  ]);
  const canReadDeliverers = permissions.includes('deliverers.read');
  const canReadTours = permissions.includes('tours.read');
  const canCreatePayment = CASH_PAYMENT_FORM_PERMISSIONS.every(
    (permission) => permissions.includes(permission),
  );
  const cashRegister = remainders.cashRegister ?? trackedBalance.cashRegister;
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div><p className={styles.eyebrow}>Gestion des espèces</p><h1>Caisse</h1><p>Suivez les mouvements et encaissez les remises des livreurs.</p></div>
        {cashRegister && <p className={styles.registerBadge}>{cashRegister.name} · {cashRegister.code} · DZD</p>}
      </header>
      <CashWorkspace canCreatePayment={canCreatePayment} withdrawalPreview={withdrawalPreview} initialWithdrawalKey={randomUUID()}
        balanceContent={<div className={styles.balanceRead}>
          <p className={styles.balanceValue}>{trackedBalance.error ? 'Non calculable' : formatCashSignedAmount(trackedBalance.balanceInCentimes)}</p>
          {trackedBalance.cashRegister && <p>{trackedBalance.cashRegister.name} · {trackedBalance.cashRegister.code}</p>}
          <p className={styles.scope}>Fonds initial + tous les encaissements − tous les retraits. Les filtres n’affectent pas ce solde ; il ne constitue pas un comptage physique du tiroir.</p>
          {trackedBalance.error && <p className={styles.error} role='alert'>{trackedBalance.error}</p>}
          {withdrawalPreview?.error && withdrawalPreview.error !== trackedBalance.error && <p className={styles.error} role='alert'>Retrait indisponible : {withdrawalPreview.error}</p>}
        </div>}>
      <div hidden={view !== 'journal'}>
        <CashJournal {...journal} {...options} canReadDeliverers={canReadDeliverers} canReadTours={canReadTours} remainderState={remainders} />
      </div>
      <div hidden={view !== 'restes'}>
      <CashRemainders
        {...remainders}
        canCreatePayment={canCreatePayment}
        canReadDeliverers={canReadDeliverers}
        canReadTours={canReadTours}
        initialConfirmationKey={randomUUID()}
        journalState={journal}
      />
      </div>
      </CashWorkspace>
    </main>
  );
};

export default CashPage;
