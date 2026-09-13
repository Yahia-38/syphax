import Link from 'next/link';

import { PermissionDeniedError, getUserPermissions } from '../../../lib/access.js';
import { listReceptions } from '../../../lib/reception-records.js';
import { getMissingReceptionFormPermissions } from '../../../lib/receptions.js';
import { requireSession } from '../../../lib/sessions.js';
import { listSuppliers } from '../../../lib/suppliers.js';
import ReceptionList from './reception-list.js';
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
  let suppliers = [];
  let receptions = [];

  if (activeTab === 'fournisseurs') {
    suppliers = await listSuppliers();
  } else {
    receptions = await listReceptions();
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
        <div role='tabpanel'>
          <div className='mt-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
            <div>
              <h2 className='text-xl font-semibold text-slate-900'>
                Réceptions de marchandises
              </h2>
              <p className='mt-1 text-sm leading-6 text-slate-600'>
                Consultez les réceptions enregistrées et leurs quantités.
              </p>
            </div>
            {canCreateReception && (
              <Link
                className='inline-flex w-fit items-center justify-center rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
                href='/receptions/nouvelle'
              >
                Nouvelle réception
              </Link>
            )}
          </div>
          <ReceptionList receptions={receptions} />
        </div>
      )}
    </main>
  );
};

export default ReceptionsPage;
