import { getUserPermissions } from '../../../lib/access.js';
import {
  listCashJournalFilterOptions,
  listCashPayments,
  listCashRemainders,
  readCashJournalState,
  readCashRemaindersState,
} from '../../../lib/cash-payments.js';
import { requirePermission } from '../../../lib/sessions.js';
import CashJournal from './cash-journal.js';
import CashRemainders from './cash-remainders.js';

export const metadata = {
  title: 'Caisse | Syphax',
};

const CashPage = async ({ searchParams }) => {
  const session = await requirePermission('cash.read');
  const resolvedSearchParams = await searchParams;
  const listState = readCashJournalState(resolvedSearchParams);
  const remainderState = readCashRemaindersState(resolvedSearchParams);
  const [journal, options, remainders, permissions] = await Promise.all([
    listCashPayments({ ...listState, userId: session.userId }),
    listCashJournalFilterOptions({ userId: session.userId }),
    listCashRemainders({ ...remainderState, userId: session.userId }),
    getUserPermissions(session.userId),
  ]);
  const canReadDeliverers = permissions.includes('deliverers.read');
  const canReadTours = permissions.includes('tours.read');

  return (
    <main className='mx-auto w-full max-w-7xl px-6 py-10 sm:py-14'>
      <div>
        <h1 className='text-3xl font-bold tracking-tight text-slate-900'>
          Caisse
        </h1>
        <p className='mt-2 text-sm leading-6 text-slate-600'>
          Consultez les encaissements déjà enregistrés depuis les tournées.
        </p>
      </div>

      <CashJournal
        {...journal}
        {...options}
        canReadDeliverers={canReadDeliverers}
        canReadTours={canReadTours}
        remainderState={remainders}
      />
      <CashRemainders
        {...remainders}
        canReadDeliverers={canReadDeliverers}
        canReadTours={canReadTours}
        journalState={journal}
      />
    </main>
  );
};

export default CashPage;
