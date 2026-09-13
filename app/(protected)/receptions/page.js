import Link from 'next/link';

import { PermissionDeniedError, getUserPermissions } from '../../../lib/access.js';
import { requireSession } from '../../../lib/sessions.js';
import { listSuppliers } from '../../../lib/suppliers.js';
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

const ReceptionPlaceholder = ({ canCreateReception }) => (
  <section
    aria-labelledby='reception-list-title'
    className='mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm'
    role='tabpanel'
  >
    <div className='border-b border-slate-200 p-5 sm:p-6'>
      <h2 className='text-lg font-semibold text-slate-900' id='reception-list-title'>
        Réceptions de marchandises
      </h2>
      <p className='mt-1 text-sm leading-6 text-slate-600'>
        La liste et le formulaire de réception seront ajoutés à la prochaine
        étape du parcours.
      </p>
    </div>
    <div className='px-6 py-14 text-center'>
      <div
        aria-hidden='true'
        className='mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-700'
      >
        <svg
          fill='none'
          height='24'
          stroke='currentColor'
          strokeLinecap='round'
          strokeLinejoin='round'
          strokeWidth='2'
          viewBox='0 0 24 24'
          width='24'
        >
          <path d='M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z' />
          <path d='m3.3 7 8.7 5 8.7-5M12 22V12' />
        </svg>
      </div>
      <h3 className='mt-4 font-semibold text-slate-900'>
        Aucune réception enregistrée
      </h3>
      <p className='mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600'>
        {canCreateReception
          ? 'Le prochain incrément permettra d’enregistrer les produits reçus et leurs montants TTC.'
          : 'Vous pourrez consulter ici les réceptions auxquelles vous avez accès.'}
      </p>
    </div>
  </section>
);

const ReceptionsPage = async ({ searchParams }) => {
  const session = await requireSession();
  const [query, permissions] = await Promise.all([
    searchParams,
    getUserPermissions(session.userId),
  ]);
  const canReadReceptions = permissions.includes('receptions.read');
  const canReadSuppliers = permissions.includes('suppliers.read');

  if (!canReadReceptions && !canReadSuppliers) {
    throw new PermissionDeniedError('receptions.read');
  }

  const requestedTab = readTab(query?.onglet);
  const activeTab = requestedTab === 'fournisseurs' && canReadSuppliers
    ? 'fournisseurs'
    : canReadReceptions
      ? 'receptions'
      : 'fournisseurs';
  const suppliers = activeTab === 'fournisseurs' ? await listSuppliers() : [];

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
        <ReceptionPlaceholder
          canCreateReception={permissions.includes('receptions.create')}
        />
      )}
    </main>
  );
};

export default ReceptionsPage;
