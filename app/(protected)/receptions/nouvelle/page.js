import Link from 'next/link';

import { getUserPermissions } from '../../../../lib/access.js';
import { BASE_UNITS, listProducts } from '../../../../lib/products.js';
import {
  formatReceptionDateInput,
  getMissingReceptionFormPermissions,
} from '../../../../lib/receptions.js';
import { requireSession } from '../../../../lib/sessions.js';
import { listSuppliers } from '../../../../lib/suppliers.js';
import ReceptionForm from '../reception-form.js';

export const metadata = {
  title: 'Nouvelle réception | Syphax',
};

const PERMISSION_LABELS = {
  'packaging.read': 'consulter les conditionnements',
  'products.read': 'consulter les produits',
  'receptions.create': 'créer des réceptions',
  'receptions.read': 'consulter les réceptions',
  'suppliers.read': 'consulter les fournisseurs',
};

const NewReceptionPage = async () => {
  const session = await requireSession();
  const permissions = await getUserPermissions(session.userId);
  const missingPermissions = getMissingReceptionFormPermissions(permissions);
  let suppliers = [];
  let products = [];

  if (missingPermissions.length === 0) {
    [suppliers, products] = await Promise.all([
      listSuppliers(),
      listProducts({ includePackagings: true }),
    ]);
    suppliers = suppliers.filter(({ active }) => active);
  }

  return (
    <main className='mx-auto w-full max-w-7xl px-6 py-10 sm:py-14'>
      <Link
        className='inline-flex items-center gap-2 rounded-lg text-sm font-medium text-blue-700 transition hover:text-blue-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700'
        href='/receptions'
      >
        <span aria-hidden='true'>←</span>
        Retour aux réceptions
      </Link>

      <div className='mt-6'>
        <h1 className='text-3xl font-bold tracking-tight text-slate-900'>
          Nouvelle réception
        </h1>
        <p className='mt-2 text-sm leading-6 text-slate-600'>
          Enregistrez un document fournisseur et les quantités reçues.
        </p>
      </div>

      {missingPermissions.length === 0 ? (
        <ReceptionForm
          baseUnits={BASE_UNITS}
          initialDate={formatReceptionDateInput(new Date())}
          products={products}
          suppliers={suppliers}
        />
      ) : (
        <section
          aria-labelledby='reception-form-unavailable-title'
          className='mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm'
        >
          <div className='border-b border-slate-200 p-5 sm:p-6'>
            <h2
              className='text-lg font-semibold text-slate-900'
              id='reception-form-unavailable-title'
            >
              Création d’une réception indisponible
            </h2>
            <p className='mt-1 text-sm leading-6 text-slate-600'>
              Le formulaire et ses données de référence restent masqués tant
              que tous les droits nécessaires ne sont pas accordés.
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
      )}
    </main>
  );
};

export default NewReceptionPage;
