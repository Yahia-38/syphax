import Link from 'next/link';

import { PermissionDeniedError, getUserPermissions } from '../../../lib/access.js';
import { BASE_UNITS, listProducts } from '../../../lib/products.js';
import { listReceptions } from '../../../lib/reception-records.js';
import {
  formatReceptionDateInput,
  getMissingReceptionFormPermissions,
  readReceptionHistoryState,
} from '../../../lib/receptions.js';
import { requireSession } from '../../../lib/sessions.js';
import { listSuppliers } from '../../../lib/suppliers.js';
import ReceptionWorkspace from './reception-workspace.js';
import SupplierWorkspace from './supplier-workspace.js';

export const metadata = {
  title: 'Réceptions | Syphax',
};

const readTab = (value) => {
  const tab = Array.isArray(value) ? value[0] : value;
  return tab === 'fournisseurs' ? 'fournisseurs' : 'receptions';
};

const TabLink = ({ active, children, href }) => (
  <Link
    aria-selected={active}
    className={`border-b-2 px-1 pb-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700 ${active ? 'border-blue-700 text-blue-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'}`}
    href={href}
    role='tab'
  >
    {children}
  </Link>
);

const ReceptionsPage = async ({ searchParams }) => {
  const session = await requireSession();
  const [query, permissions] = await Promise.all([
    searchParams,
    getUserPermissions(session.userId),
  ]);
  const canReadReceptions = permissions.includes('receptions.read');
  const canReadSuppliers = permissions.includes('suppliers.read');
  const canCreateReception = getMissingReceptionFormPermissions(
    permissions,
  ).length === 0;

  if (!canReadReceptions && !canReadSuppliers) {
    throw new PermissionDeniedError('receptions.read');
  }

  const requestedTab = readTab(query?.onglet);
  const activeTab = requestedTab === 'fournisseurs' && canReadSuppliers
    ? 'fournisseurs'
    : canReadReceptions
      ? 'receptions'
      : 'fournisseurs';
  const historyState = readReceptionHistoryState(query);
  let suppliers = [];
  let products = [];
  let receptions = [];

  if (activeTab === 'fournisseurs') {
    suppliers = await listSuppliers();
  } else {
    [receptions, suppliers, products] = await Promise.all([
      listReceptions({ userId: session.userId }),
      canCreateReception ? listSuppliers() : [],
      canCreateReception ? listProducts({ includePackagings: true }) : [],
    ]);
    suppliers = suppliers.filter(({ active }) => active);
  }

  return (
    <main className='mx-auto w-full max-w-7xl px-6 py-10 sm:py-14'>
      <div>
        <h1 className='text-3xl font-bold tracking-tight text-slate-900'>
          Réceptions
        </h1>
        <p className='mt-2 text-sm leading-6 text-slate-600'>
          Gérez les fournisseurs et l’entrée des marchandises dans un même
          parcours.
        </p>
      </div>

      <nav
        aria-label='Sections des réceptions'
        className='mt-8 flex gap-7 border-b border-slate-200'
        role='tablist'
      >
        {canReadReceptions && (
          <TabLink active={activeTab === 'receptions'} href='/receptions'>
            Réceptions
          </TabLink>
        )}
        {canReadSuppliers && (
          <TabLink
            active={activeTab === 'fournisseurs'}
            href='/receptions?onglet=fournisseurs'
          >
            Fournisseurs
          </TabLink>
        )}
      </nav>

      {activeTab === 'fournisseurs' ? (
        <SupplierWorkspace
          canCreateSupplier={permissions.includes('suppliers.create')}
          canDeleteSupplier={permissions.includes('suppliers.delete')}
          canUpdateSupplier={permissions.includes('suppliers.update')}
          suppliers={suppliers}
        />
      ) : (
        <ReceptionWorkspace
          baseUnits={BASE_UNITS}
          canCreateReception={canCreateReception}
          initialDate={formatReceptionDateInput(new Date())}
          initialHistoryPage={historyState.page}
          initialHistoryQuery={historyState.query}
          initialHistorySupplierId={historyState.supplierId}
          products={products}
          receptions={receptions}
          suppliers={suppliers}
        />
      )}
    </main>
  );
};

export default ReceptionsPage;
