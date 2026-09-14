import Link from 'next/link';

import {
  buildCashJournalHref,
  formatCashAmount,
  formatCashPaymentDateTime,
} from '../../../lib/cash-payments.js';

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

const CashJournal = ({
  canReadDeliverers,
  canReadTours,
  cashRegisters,
  dateFrom,
  dateTo,
  delivererId,
  deliverers,
  page,
  pageSize,
  payments,
  query,
  remainderState,
  totalAmountInCentimes,
  totalItems,
  totalPages,
}) => {
  const filtersActive = Boolean(query || delivererId || dateFrom || dateTo);
  const firstItem = totalItems > 0 ? (page - 1) * pageSize + 1 : 0;
  const lastItem = firstItem + payments.length - 1;
  const getPageHref = (nextPage) => buildCashJournalHref({
    dateFrom,
    dateTo,
    delivererId,
    page: nextPage,
    query,
    remainderPage: remainderState.page,
    remainderQuery: remainderState.query,
  });
  const resetHref = buildCashJournalHref({
    remainderPage: remainderState.page,
    remainderQuery: remainderState.query,
  });

  return (
    <>
      <section
        aria-labelledby='cash-register-title'
        className='mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6'
      >
        <p className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
          {cashRegisters.length === 1 ? 'Caisse concernée' : 'Caisses concernées'}
        </p>
        <h2 className='mt-2 text-lg font-semibold text-slate-900' id='cash-register-title'>
          {cashRegisters.length === 1
            ? `${cashRegisters[0].name || 'Caisse sans nom'} — ${cashRegisters[0].code}`
            : cashRegisters.length > 1
              ? cashRegisters
                  .map(({ code, name }) => `${name || 'Caisse sans nom'} — ${code}`)
                  .join(' · ')
              : 'Aucune caisse associée à un encaissement'}
        </h2>
        <p className='mt-4 text-sm font-medium text-slate-600'>
          Total encaissé sur la sélection
        </p>
        <p className='mt-1 text-3xl font-bold tracking-tight text-slate-900'>
          {formatCashAmount(totalAmountInCentimes)}
        </p>
        <p className='mt-2 text-xs leading-5 text-slate-500'>
          Ce total reprend uniquement les versements enregistrés correspondant aux filtres.
        </p>
      </section>

      <section
        aria-labelledby='cash-journal-title'
        className='mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm'
      >
        <div className='border-b border-slate-200 p-5 sm:p-6'>
          <h2 className='text-lg font-semibold text-slate-900' id='cash-journal-title'>
            Journal des encaissements
          </h2>
          <p className='mt-1 text-sm leading-6 text-slate-600'>
            Consultez les versements déjà enregistrés, du plus récent au plus ancien.
          </p>
        </div>

        <form
          action='/caisse'
          className='grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,1fr)_minmax(12rem,0.8fr)_10rem_10rem_auto_auto]'
          method='get'
          role='search'
        >
          {remainderState.query && (
            <input
              name='resteRecherche'
              type='hidden'
              value={remainderState.query}
            />
          )}
          {remainderState.page > 1 && (
            <input
              name='restePage'
              type='hidden'
              value={remainderState.page}
            />
          )}
          <div>
            <label className='sr-only' htmlFor='cash-search'>
              Rechercher un encaissement
            </label>
            <input
              className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
              defaultValue={query}
              id='cash-search'
              maxLength={100}
              name='q'
              placeholder='Versement, code ou nom du livreur'
              type='search'
            />
          </div>
          <div>
            <label className='sr-only' htmlFor='cash-deliverer-filter'>
              Filtrer par livreur
            </label>
            <select
              className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
              defaultValue={delivererId}
              id='cash-deliverer-filter'
              name='livreur'
            >
              <option value=''>Tous les livreurs</option>
              {deliverers.map((deliverer) => (
                <option key={deliverer.id} value={deliverer.id}>
                  {deliverer.code} — {deliverer.name || 'Nom non renseigné'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className='sr-only' htmlFor='cash-date-from'>
              Date de début
            </label>
            <input
              className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
              defaultValue={dateFrom}
              id='cash-date-from'
              name='du'
              title='Date de début'
              type='date'
            />
          </div>
          <div>
            <label className='sr-only' htmlFor='cash-date-to'>
              Date de fin
            </label>
            <input
              className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
              defaultValue={dateTo}
              id='cash-date-to'
              name='au'
              title='Date de fin'
              type='date'
            />
          </div>
          <button
            className='rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            type='submit'
          >
            Rechercher
          </button>
          {filtersActive && (
            <Link
              className='inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
              href={resetHref}
            >
              Réinitialiser
            </Link>
          )}
        </form>

        <div className='flex min-h-12 items-center border-b border-slate-200 px-4 py-3 sm:px-6'>
          <p className='text-sm text-slate-500'>
            {totalItems > 0
              ? `${firstItem}–${lastItem} sur ${totalItems} encaissements`
              : '0 encaissement'}
          </p>
        </div>

        {payments.length > 0 ? (
          <>
            <table className='w-full table-fixed divide-y divide-slate-200'>
              <caption className='sr-only'>Journal des encaissements</caption>
              <thead>
                <tr>
                  {[
                    ['Date et heure', 'w-[16%]'],
                    ['Référence du versement', 'w-[20%]'],
                    ['Livreur', 'w-[18%]'],
                    ['Affectations', 'w-[18%]'],
                    ['Montant en DA', 'w-[14%]'],
                    ['Auteur de l’encaissement', 'w-[14%]'],
                  ].map(([label, width]) => (
                    <th
                      className={`${width} bg-slate-50 px-2 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-4`}
                      key={label}
                      scope='col'
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className='divide-y divide-slate-100 bg-white'>
                {payments.map((payment) => (
                  <tr className='align-top hover:bg-slate-50' key={payment.id}>
                    <td className='break-words px-2 py-3 text-xs text-slate-600 sm:px-4'>
                      {formatCashPaymentDateTime(payment.receivedAt)}
                    </td>
                    <td className='break-all px-2 py-3 font-mono text-xs font-semibold text-slate-900 sm:px-4'>
                      {payment.reference}
                      {payment.note && (
                        <details className='mt-2 font-sans font-normal text-slate-600'>
                          <summary className='cursor-pointer text-xs font-medium text-blue-800'>
                            Voir la note
                          </summary>
                          <p className='mt-2 whitespace-pre-wrap break-words leading-5'>
                            {payment.note}
                          </p>
                        </details>
                      )}
                    </td>
                    <td className='break-words px-2 py-3 text-xs text-slate-700 sm:px-4'>
                      {canReadDeliverers && payment.deliverer.id ? (
                        <Link
                          className='font-medium text-blue-800 hover:text-blue-950 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
                          href={`/livreurs/${payment.deliverer.id}`}
                        >
                          {payment.deliverer.code}
                        </Link>
                      ) : (
                        <span className='font-medium text-slate-900'>
                          {payment.deliverer.code}
                        </span>
                      )}
                      <span className='mt-1 block'>{payment.deliverer.name}</span>
                    </td>
                    <td className='break-words px-2 py-3 text-xs text-slate-700 sm:px-4'>
                      {payment.allocations ? (
                        <details>
                          <summary className='cursor-pointer font-semibold text-blue-800'>
                            {payment.allocations.length} affectation{payment.allocations.length > 1 ? 's' : ''}
                          </summary>
                          <div className='mt-2 space-y-2'>
                            {payment.allocations.map((allocation) => (
                              <div
                                className='rounded-lg bg-slate-50 p-2'
                                key={allocation.id}
                              >
                                <p className='break-all font-mono'>
                                  {canReadTours && allocation.id ? (
                                    <Link
                                      className='font-semibold text-blue-800 hover:text-blue-950 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
                                      href={`/tournees/${allocation.id}`}
                                    >
                                      {allocation.reference}
                                    </Link>
                                  ) : allocation.reference}
                                </p>
                                <p className='mt-1 font-semibold text-slate-900'>
                                  {formatCashAmount(allocation.amountInCentimes)}
                                </p>
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : (
                        <span className='font-medium text-red-700'>
                          Affectations incohérentes
                        </span>
                      )}
                    </td>
                    <td className='break-words px-2 py-3 text-xs font-semibold text-slate-900 sm:px-4'>
                      {formatCashAmount(payment.amountInCentimes)}
                    </td>
                    <td className='break-words px-2 py-3 text-xs text-slate-700 sm:px-4'>
                      {payment.author ?? 'Compte indisponible'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <nav
              aria-label='Pagination des encaissements'
              className='flex items-center justify-between gap-4 border-t border-slate-200 px-4 py-3 sm:px-6'
            >
              <PaginationLink disabled={page === 1} href={getPageHref(page - 1)}>
                Précédent
              </PaginationLink>
              <p className='text-sm font-medium text-slate-600'>
                Page {page} sur {totalPages}
              </p>
              <PaginationLink
                disabled={page === totalPages}
                href={getPageHref(page + 1)}
              >
                Suivant
              </PaginationLink>
            </nav>
          </>
        ) : (
          <div className='px-6 py-14 text-center'>
            <h3 className='font-semibold text-slate-900'>
              {filtersActive
                ? 'Aucun résultat pour ces filtres'
                : 'Aucun encaissement enregistré'}
            </h3>
            <p className='mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600'>
              {filtersActive
                ? 'Modifiez ou réinitialisez les critères de recherche.'
                : 'Les versements déjà enregistrés depuis les tournées apparaîtront ici.'}
            </p>
          </div>
        )}
      </section>
    </>
  );
};

export default CashJournal;
