import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  formatDelivererCreatedAt,
  getDelivererById,
  validateDelivererListHref,
} from '../../../../lib/deliverers.js';
import { requirePermission } from '../../../../lib/sessions.js';

export const metadata = {
  title: 'Fiche livreur | Syphax',
};

const DelivererPage = async ({ params, searchParams }) => {
  const session = await requirePermission('deliverers.read');
  const [{ id }, query = {}] = await Promise.all([
    params,
    searchParams,
  ]);
  const deliverer = await getDelivererById(id, {
    userId: session.userId,
  });

  if (!deliverer) {
    notFound();
  }

  const returnHref = validateDelivererListHref(query.retour);

  return (
    <main className='mx-auto w-full max-w-7xl px-6 py-10 sm:py-14'>
      <Link
        className='inline-flex items-center gap-2 rounded-lg text-sm font-medium text-blue-700 transition hover:text-blue-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700'
        href={returnHref}
      >
        <span aria-hidden='true'>←</span>
        Retour aux livreurs
      </Link>

      <header className='mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm'>
        <div className='border-b border-slate-200 p-5 sm:p-6'>
          <p className='text-xs font-semibold uppercase tracking-wide text-blue-700'>
            Fiche livreur
          </p>
          <h1 className='mt-2 break-words text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl'>
            {deliverer.name}
          </h1>
          <p className='mt-2 font-mono text-sm font-semibold text-slate-600'>
            {deliverer.code}
          </p>
        </div>

        <div className='grid gap-px bg-slate-200 lg:grid-cols-[2fr_1fr]'>
          <section
            aria-labelledby='deliverer-identification-title'
            className='bg-white'
          >
            <div className='border-b border-slate-100 px-5 py-4 sm:px-6'>
              <h2
                className='text-lg font-semibold text-slate-900'
                id='deliverer-identification-title'
              >
                Identification
              </h2>
            </div>
            <dl className='px-5 sm:px-6'>
              <div className='flex items-baseline justify-between gap-6 border-b border-slate-100 py-4'>
                <dt className='text-sm font-medium text-slate-500'>Code</dt>
                <dd className='break-all text-right font-mono text-sm font-semibold text-slate-900'>
                  {deliverer.code}
                </dd>
              </div>
              <div className='flex items-baseline justify-between gap-6 border-b border-slate-100 py-4'>
                <dt className='text-sm font-medium text-slate-500'>Nom</dt>
                <dd className='break-words text-right text-sm font-semibold text-slate-900'>
                  {deliverer.name}
                </dd>
              </div>
              <div className='flex items-baseline justify-between gap-6 py-4'>
                <dt className='text-sm font-medium text-slate-500'>Téléphone</dt>
                <dd className='break-words text-right text-sm font-semibold text-slate-900'>
                  {deliverer.phone || 'Non renseigné'}
                </dd>
              </div>
            </dl>
          </section>

          <aside
            aria-labelledby='deliverer-traceability-title'
            className='bg-white'
          >
            <div className='border-b border-slate-100 px-5 py-4 sm:px-6'>
              <h2
                className='text-lg font-semibold text-slate-900'
                id='deliverer-traceability-title'
              >
                Traçabilité
              </h2>
            </div>
            <dl className='flex flex-col gap-5 px-5 py-5 sm:px-6'>
              <div>
                <dt className='text-sm font-medium text-slate-500'>Créé le</dt>
                <dd className='mt-1 text-sm text-slate-900'>
                  {formatDelivererCreatedAt(deliverer.createdAt)}
                </dd>
              </div>
              <div>
                <dt className='text-sm font-medium text-slate-500'>Créé par</dt>
                <dd className='mt-1 text-sm text-slate-900'>
                  {deliverer.createdBy ?? 'Compte indisponible'}
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      </header>
    </main>
  );
};

export default DelivererPage;
