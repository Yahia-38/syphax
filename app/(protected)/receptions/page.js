import Link from 'next/link';

import { PermissionDeniedError, getUserPermissions } from '../../../lib/access.js';
import { BASE_UNITS, listProducts } from '../../../lib/products.js';
import { getMissingReceptionFormPermissions } from '../../../lib/receptions.js';
import { requireSession } from '../../../lib/sessions.js';
import { listSuppliers } from '../../../lib/suppliers.js';
import ReceptionForm from './reception-form.js';
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

const PERMISSION_LABELS = {
  'packaging.read': 'consulter les conditionnements',
  'products.read': 'consulter les produits',
  'receptions.create': 'créer des réceptions',
  'receptions.read': 'consulter les réceptions',
  'suppliers.read': 'consulter les fournisseurs',
};

const ReceptionFormUnavailable = ({ missingPermissions }) => (
  <section
    aria-labelledby='reception-form-unavailable-title'
    className='mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm'
    role='tabpanel'
  >
    <div className='border-b border-slate-200 p-5 sm:p-6'>
      <h2
        className='text-lg font-semibold text-slate-900'
        id='reception-form-unavailable-title'
      >
        Création d’une réception indisponible
      </h2>
      <p className='mt-1 text-sm leading-6 text-slate-600'>
        Le formulaire et ses données de référence restent masqués tant que
        tous les droits nécessaires ne sont pas accordés.
      </p>
    </div>
    <div className='p-5 sm:p-6'>
      <p className='text-sm font-medium text-slate-800'>Droits manquants :</p>
      <p className='mt-2 text-sm leading-6 text-slate-600'>
        {missingPermissions
          .map((permission) => PERMISSION_LABELS[permission] ?? permission)
          .join(', ')}.
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
  let suppliers = [];
  let receptionProducts = [];
  const missingReceptionFormPermissions = activeTab === 'receptions'
    ? getMissingReceptionFormPermissions(permissions)
    : [];

  if (activeTab === 'fournisseurs') {
    suppliers = await listSuppliers();
  } else if (missingReceptionFormPermissions.length === 0) {
    [suppliers, receptionProducts] = await Promise.all([
      listSuppliers(),
      listProducts({ includePackagings: true }),
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
        missingReceptionFormPermissions.length === 0 ? (
          <ReceptionForm
            baseUnits={BASE_UNITS}
            products={receptionProducts}
            suppliers={suppliers}
          />
        ) : (
          <ReceptionFormUnavailable
            missingPermissions={missingReceptionFormPermissions}
          />
        )
      )}
    </main>
  );
};

export default ReceptionsPage;
