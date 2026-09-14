import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getUserPermissions } from '../../../../lib/access.js';
import {
  formatDelivererCreatedAt,
  getDelivererById,
  requireDelivererEditPermission,
  validateDelivererListHref,
} from '../../../../lib/deliverers.js';
import { requirePermission } from '../../../../lib/sessions.js';
import DelivererEditForm from './deliverer-edit-form.js';
import DelivererStatusButton from './deliverer-status-button.js';

export const metadata = {
  title: 'Fiche livreur | Syphax',
};

const buildDelivererHref = ({ delivererId, editing = false, returnHref }) => {
  const parameters = new URLSearchParams({ retour: returnHref });

  if (editing) {
    parameters.set('modifier', '1');
  }

  return `/livreurs/${delivererId}?${parameters.toString()}`;
};

const DelivererPage = async ({ params, searchParams }) => {
  const session = await requirePermission('deliverers.read');
  const [{ id }, query = {}, permissions] = await Promise.all([
    params,
    searchParams,
    getUserPermissions(session.userId),
  ]);
  const canUpdateDeliverer = permissions.includes('deliverers.update');
  const canUpdateDelivererStatus = permissions.includes(
    'deliverers.status.update',
  );
  const editing = query.modifier === '1';

  await requireDelivererEditPermission({
    editing,
    userId: session.userId,
  });

  const deliverer = await getDelivererById(id, {
    userId: session.userId,
  });

  if (!deliverer) {
    notFound();
  }

  const returnHref = validateDelivererListHref(query.retour);
  const viewHref = buildDelivererHref({
    delivererId: deliverer.id,
    returnHref,
  });
  const editHref = buildDelivererHref({
    delivererId: deliverer.id,
    editing: true,
    returnHref,
  });
  const latestStatusChange = deliverer.statusHistory.at(-1);

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
        <div className='flex flex-col gap-5 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6'>
          <div className='min-w-0'>
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
          <div className='flex flex-wrap items-center gap-3'>
            <span
              className={deliverer.active
                ? 'inline-flex rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800'
                : 'inline-flex rounded-full bg-slate-200 px-3 py-1 text-sm font-semibold text-slate-700'}
            >
              {deliverer.active ? 'Actif' : 'Désactivé'}
            </span>
            {canUpdateDelivererStatus && (
              <DelivererStatusButton
                deliverer={{
                  active: deliverer.active,
                  code: deliverer.code,
                  id: deliverer.id,
                  name: deliverer.name,
                }}
                returnHref={returnHref}
              />
            )}
          </div>
        </div>

        <div className='grid gap-px bg-slate-200 lg:grid-cols-[2fr_1fr]'>
          <section
            aria-labelledby='deliverer-identification-title'
            className='bg-white'
          >
            <div className='flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6'>
              <h2
                className='text-lg font-semibold text-slate-900'
                id='deliverer-identification-title'
              >
                {editing ? 'Modifier l’identification' : 'Identification'}
              </h2>
              {canUpdateDeliverer && !editing && (
                <Link
                  aria-label='Modifier les informations du livreur'
                  className='inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-blue-700 transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
                  href={editHref}
                  title='Modifier les informations du livreur'
                >
                  <svg
                    aria-hidden='true'
                    fill='none'
                    height='18'
                    stroke='currentColor'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth='2'
                    viewBox='0 0 24 24'
                    width='18'
                  >
                    <path d='M12 20h9' />
                    <path d='M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z' />
                  </svg>
                </Link>
              )}
            </div>
            {editing ? (
              <DelivererEditForm
                deliverer={deliverer}
                returnHref={returnHref}
                viewHref={viewHref}
              />
            ) : (
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
            )}
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
              {deliverer.updatedAt && (
                <>
                  <div>
                    <dt className='text-sm font-medium text-slate-500'>Modifié le</dt>
                    <dd className='mt-1 text-sm text-slate-900'>
                      {formatDelivererCreatedAt(deliverer.updatedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className='text-sm font-medium text-slate-500'>Modifié par</dt>
                    <dd className='mt-1 text-sm text-slate-900'>
                      {deliverer.updatedBy ?? 'Compte indisponible'}
                    </dd>
                  </div>
                </>
              )}
              {latestStatusChange && (
                <>
                  <div>
                    <dt className='text-sm font-medium text-slate-500'>
                      Statut modifié le
                    </dt>
                    <dd className='mt-1 text-sm text-slate-900'>
                      {formatDelivererCreatedAt(latestStatusChange.changedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className='text-sm font-medium text-slate-500'>
                      Statut modifié par
                    </dt>
                    <dd className='mt-1 text-sm text-slate-900'>
                      {latestStatusChange.changedBy ?? 'Compte indisponible'}
                    </dd>
                  </div>
                </>
              )}
            </dl>
          </aside>
        </div>
      </header>
    </main>
  );
};

export default DelivererPage;
