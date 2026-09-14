import Link from 'next/link';

import {
  buildCashRemaindersHref,
  formatCashAmount,
} from '../../../lib/cash-payments.js';

const STATUS_LABELS = Object.freeze({
  CLOSED: 'Terminée',
  COUNTED: 'Comptée',
});

const PaginationLink = ({ children, disabled, href }) => disabled ? (
  <span
    aria-disabled='true'
    className='cursor-not-allowed rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-400 opacity-60'
  >
    {children}
  </span>
) : (
  <Link
    className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
    href={href}
  >
    {children}
  </Link>
);

const PreservedJournalFields = ({ journalState }) => [
  ['q', journalState.query],
  ['livreur', journalState.delivererId],
  ['du', journalState.dateFrom],
  ['au', journalState.dateTo],
  ['page', journalState.page > 1 ? String(journalState.page) : ''],
].filter(([, value]) => value).map(([name, value]) => (
  <input key={name} name={name} type='hidden' value={value} />
));

const CashRemainders = ({
  anomalies,
  anomalyCount,
  canReadDeliverers,
  canReadTours,
  journalState,
  page,
  pageSize,
  query,
  remainders,
  totalItems,
  totalPages,
  totalRemainingDueInCentimes,
}) => {
  const firstItem = totalItems > 0 ? (page - 1) * pageSize + 1 : 0;
  const lastItem = firstItem + remainders.length - 1;
  const getHref = ({ nextPage = page, nextQuery = query } = {}) =>
    buildCashRemaindersHref({
      ...journalState,
      journalPage: journalState.page,
      journalQuery: journalState.query,
      page: nextPage,
      query: nextQuery,
    });

  return (
    <section
      aria-labelledby='cash-remainders-title'
      className='mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm'
    >
      <div className='border-b border-slate-200 p-5 sm:p-6'>
        <p className='text-xs font-semibold uppercase tracking-wide text-amber-700'>
          Situation actuelle
        </p>
        <h2 className='mt-2 text-lg font-semibold text-slate-900' id='cash-remainders-title'>
          Restes à encaisser
        </h2>
        <p className='mt-1 max-w-3xl text-sm leading-6 text-slate-600'>
          Restes des tournées comptées ou terminées uniquement. Ce récapitulatif
          n’intègre ni avances, ni dépenses, ni dettes externes.
        </p>
        <p className='mt-5 text-sm font-medium text-slate-600'>
          Total à encaisser sur les résultats
        </p>
        <p className='mt-1 text-3xl font-bold tracking-tight text-slate-900'>
          {formatCashAmount(totalRemainingDueInCentimes)}
        </p>
      </div>

      <form
        action='/caisse'
        className='flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row'
        method='get'
        role='search'
      >
        <PreservedJournalFields journalState={journalState} />
        <div className='min-w-0 flex-1'>
          <label className='sr-only' htmlFor='cash-remainder-search'>
            Rechercher un livreur ayant un reste à encaisser
          </label>
          <input
            className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
            defaultValue={query}
            id='cash-remainder-search'
            maxLength={100}
            name='resteRecherche'
            placeholder='Code ou nom du livreur'
            type='search'
          />
        </div>
        <button
          className='rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
          type='submit'
        >
          Rechercher
        </button>
        {query && (
          <Link
            className='inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            href={getHref({ nextPage: 1, nextQuery: '' })}
          >
            Réinitialiser
          </Link>
        )}
      </form>

      {anomalyCount > 0 && (
        <aside
          aria-labelledby='cash-remainder-anomalies-title'
          className='border-b border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950 sm:px-6'
        >
          <h3 className='font-semibold' id='cash-remainder-anomalies-title'>
            {anomalyCount} {anomalyCount === 1 ? 'anomalie empêche' : 'anomalies empêchent'} le calcul
          </h3>
          <p className='mt-1 leading-6'>
            Les tournées concernées ne sont pas incluses dans les totaux tant que
            leurs données restent incohérentes.
          </p>
          {anomalies.map((anomaly) => (
            <p className='mt-2 leading-6' key={anomaly.code}>
              <span className='font-medium'>{anomaly.label}</span>
              {' : '}
              {anomaly.tourReferences.join(', ')}
            </p>
          ))}
        </aside>
      )}

      <div className='border-b border-slate-200 px-4 py-3 sm:px-6'>
        <p className='text-sm text-slate-500'>
          {totalItems > 0
            ? `${firstItem}–${lastItem} sur ${totalItems} livreurs`
            : '0 livreur'}
        </p>
      </div>

      {remainders.length > 0 ? (
        <>
          <div className='hidden grid-cols-[minmax(0,1fr)_10rem_12rem] gap-4 bg-slate-50 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid sm:px-6'>
            <span>Livreur</span>
            <span>Tournées concernées</span>
            <span>Reste total</span>
          </div>
          {remainders.map((remainder) => (
            <article
              className='border-t border-slate-100 px-5 py-4 first:border-t-0 sm:px-6'
              key={remainder.deliverer.id}
            >
              <div className='grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_12rem] sm:items-start sm:gap-4'>
                <div className='min-w-0 text-sm text-slate-700'>
                  {canReadDeliverers ? (
                    <Link
                      className='font-semibold text-blue-800 hover:text-blue-950 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
                      href={`/livreurs/${remainder.deliverer.id}`}
                    >
                      {remainder.deliverer.code}
                    </Link>
                  ) : (
                    <span className='font-semibold text-slate-900'>
                      {remainder.deliverer.code}
                    </span>
                  )}
                  <span className='mt-1 block break-words'>
                    {remainder.deliverer.name || 'Nom non renseigné'}
                  </span>
                </div>
                <p className='text-sm text-slate-700'>
                  <span className='font-semibold text-slate-900 sm:hidden'>
                    Tournées :{' '}
                  </span>
                  {remainder.tourCount}
                </p>
                <p className='text-sm font-semibold text-slate-900'>
                  <span className='sm:hidden'>Reste : </span>
                  {formatCashAmount(remainder.remainingDueInCentimes)}
                </p>
              </div>

              <details className='mt-4 rounded-xl border border-slate-200 bg-slate-50'>
                <summary className='cursor-pointer px-4 py-3 text-sm font-medium text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'>
                  Voir le détail des tournées
                </summary>
                <div className='border-t border-slate-200 px-4 py-1'>
                  {remainder.tours.map((tour) => (
                    <div
                      className='grid gap-2 border-t border-slate-200 py-4 first:border-t-0 sm:grid-cols-[minmax(0,1.2fr)_8rem_repeat(3,minmax(7rem,1fr))] sm:gap-4'
                      key={tour.id}
                    >
                      <p className='break-all font-mono text-xs font-semibold text-slate-900'>
                        <span className='mb-1 block font-sans text-[11px] font-medium uppercase tracking-wide text-slate-500'>
                          Tournée
                        </span>
                        {canReadTours ? (
                          <Link
                            className='text-blue-800 hover:text-blue-950 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
                            href={`/tournees/${tour.id}`}
                          >
                            {tour.reference}
                          </Link>
                        ) : tour.reference}
                      </p>
                      <p className='text-xs text-slate-700'>
                        <span className='mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500'>
                          Statut
                        </span>
                        {STATUS_LABELS[tour.status] ?? tour.status}
                      </p>
                      <p className='text-xs text-slate-700'>
                        <span className='mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500'>
                          Montant dû
                        </span>
                        {formatCashAmount(tour.amountDueInCentimes)}
                      </p>
                      <p className='text-xs text-slate-700'>
                        <span className='mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500'>
                          Encaissé
                        </span>
                        {formatCashAmount(tour.amountPaidInCentimes)}
                      </p>
                      <p className='text-xs font-semibold text-slate-900'>
                        <span className='mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500'>
                          Reste à payer
                        </span>
                        {formatCashAmount(tour.remainingDueInCentimes)}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            </article>
          ))}

          <nav
            aria-label='Pagination des restes à encaisser'
            className='flex items-center justify-between gap-4 border-t border-slate-200 px-4 py-3 sm:px-6'
          >
            <PaginationLink
              disabled={page === 1}
              href={getHref({ nextPage: page - 1 })}
            >
              Précédent
            </PaginationLink>
            <p className='text-sm font-medium text-slate-600'>
              Page {page} sur {totalPages}
            </p>
            <PaginationLink
              disabled={page === totalPages}
              href={getHref({ nextPage: page + 1 })}
            >
              Suivant
            </PaginationLink>
          </nav>
        </>
      ) : (
        <div className='px-6 py-14 text-center'>
          <h3 className='font-semibold text-slate-900'>
            {query
              ? 'Aucun reste pour cette recherche'
              : 'Aucun reste positif à encaisser'}
          </h3>
          <p className='mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600'>
            {query
              ? 'Modifiez ou réinitialisez la recherche par livreur.'
              : 'Toutes les tournées comptées valides sont soldées.'}
          </p>
        </div>
      )}
    </section>
  );
};

export default CashRemainders;
