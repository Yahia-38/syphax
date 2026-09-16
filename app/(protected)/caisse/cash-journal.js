import { EditingLink as Link } from '../components/editing-session.js';
import { CashFilterForm, CashResetLink, CashPageLink } from './cash-workspace.js';
import { formatCashSignedAmount } from '../../../lib/cash-navigation.js';
import styles from './cash.module.css';
import CashJournalAllocations from './cash-journal-allocations.js';

import {
  formatCashAmount,
  formatCashPaymentDateTime,
} from '../../../lib/cash-payments.js';

const PaginationLink = ({ children, disabled, page }) => disabled ? (
  <span
    aria-disabled='true'
    className='cursor-not-allowed rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-400 opacity-60'
  >
    {children}
  </span>
) : (
  <CashPageLink view='journal' page={page}
    className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
  >
    {children}
  </CashPageLink>
);

const CashJournal = ({
  canReadDeliverers,
  canReadTours,
  dateFrom,
  dateTo,
  delivererId,
  deliverers,
  financialDataError,
  netVariationInCentimes,
  page,
  pageSize,
  payments,
  query,
  remainderState,
  totalEntriesInCentimes,
  totalItems,
  totalPages,
  totalWithdrawalsInCentimes,
}) => {
  const filtersActive = Boolean(query || delivererId || dateFrom || dateTo);
  const firstItem = totalItems > 0 ? (page - 1) * pageSize + 1 : 0;
  const lastItem = firstItem + payments.length - 1;
  return (
    <>
      <section
        aria-labelledby='cash-journal-title'
        className={styles.journal}
      >
        <div className='border-b border-slate-200 p-5 sm:p-6'>
          <h2 className='text-lg font-semibold text-slate-900' id='cash-journal-title'>
            Journal de caisse
          </h2>
          <p className='mt-1 text-sm leading-6 text-slate-600'>
            Consultez les encaissements et les retraits, du plus récent au plus ancien.
          </p>
        </div>

        <CashFilterForm view='journal'
          action='/caisse'
          className='grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,1fr)_minmax(12rem,0.8fr)_10rem_10rem_auto_auto]'
          method='get'
          role='search'
        >
          <input type='hidden' name='vue' value='journal' />
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
            <label className={styles.filterLabel} htmlFor='cash-search'>
              Référence, livreur, note ou motif
            </label>
            <input
              className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
              defaultValue={query}
              id='cash-search'
              maxLength={100}
              name='q'
              placeholder='Référence, livreur, note ou motif'
              type='search'
            />
          </div>
          <div>
            <label className={styles.filterLabel} htmlFor='cash-deliverer-filter'>
              Livreur
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
            <label className={styles.filterLabel} htmlFor='cash-date-from'>
              Du
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
            <label className={styles.filterLabel} htmlFor='cash-date-to'>
              Au
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
            Appliquer
          </button>
          {filtersActive && (
            <CashResetLink view='journal'
              className='inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            >
              Réinitialiser
            </CashResetLink>
          )}
        </CashFilterForm>
        {delivererId && <p className={styles.scopeNote}>Le filtre livreur exclut les retraits : ceux-ci ne sont rattachés à aucun livreur.</p>}
        {dateFrom && dateTo && dateFrom > dateTo && <p className={styles.error} role='alert'>La date « Du » doit précéder ou égaler la date « Au ».</p>}
        <div className={styles.selectionTotals}>
          <p className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
            Sur la sélection · toutes les pages
          </p>
          {financialDataError ? (
            <p className='mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900' role='alert'>
              {financialDataError}
            </p>
          ) : (
            <dl className='mt-3 grid gap-3 sm:grid-cols-3'>
              {[
                ['Entrées', formatCashAmount(totalEntriesInCentimes), 'text-emerald-800'],
                ['Sorties', formatCashAmount(totalWithdrawalsInCentimes), 'text-red-800'],
                ['Variation nette', formatCashSignedAmount(netVariationInCentimes), 'text-slate-950'],
              ].map(([label, value, color]) => (
                <div className='rounded-xl bg-slate-50 p-4' key={label}>
                  <dt className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
                    {label}
                  </dt>
                  <dd className={`mt-1 text-xl font-bold ${color}`}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className='mt-3 text-xs leading-5 text-slate-500'>
            La variation filtrée dépend des critères ci-dessous ; elle ne doit
            pas être confondue avec le solde suivi global.
          </p>
        </div>

        <div className='flex min-h-12 items-center border-b border-slate-200 px-4 py-3 sm:px-6'>
          <p className='text-sm text-slate-500'>
            {totalItems > 0
              ? `${firstItem}–${lastItem} sur ${totalItems} mouvements`
              : '0 mouvement'}
          </p>
        </div>

        {payments.length > 0 ? (
          <>
            <table className={styles.journalTable}>
              <caption className='sr-only'>Journal des mouvements de caisse</caption>
              <thead>
                <tr>
                  {[
                    ['Type', 'w-[12%]'],
                    ['Date et heure', 'w-[16%]'],
                    ['Référence', 'w-[19%]'],
                    ['Informations', 'w-[25%]'],
                    ['Montant en DA', 'w-[14%]'],
                    ['Auteur', 'w-[14%]'],
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
                    <td data-label='Type' className='break-words px-2 py-3 text-xs font-semibold sm:px-4'>
                      <span className={payment.type === 'WITHDRAWAL'
                        ? 'text-red-800'
                        : 'text-emerald-800'}>
                        {payment.type === 'WITHDRAWAL'
                          ? 'Retrait'
                          : 'Encaissement'}
                      </span>
                    </td>
                    <td data-label='Date & heure' className='break-words px-2 py-3 text-xs text-slate-600 sm:px-4'>
                      {formatCashPaymentDateTime(payment.receivedAt)}
                    </td>
                    <td data-label='Référence' className='break-all px-2 py-3 font-mono text-xs font-semibold text-slate-900 sm:px-4'>
                      {payment.reference}
                      {payment.type === 'PAYMENT' && payment.note && (
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
                    <td data-label='Informations' className='break-words px-2 py-3 text-xs text-slate-700 sm:px-4'>
                      {payment.type === 'WITHDRAWAL' ? (
                        <>
                          <p className='font-semibold text-slate-900'>Motif</p>
                          <p className='mt-1 whitespace-pre-wrap break-words'>
                            {payment.reason}
                          </p>
                        </>
                      ) : (
                        <>
                          <p>
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
                            <span className='ml-1'>{payment.deliverer.name}</span>
                          </p>
                          {payment.allocations ? (
                            <CashJournalAllocations allocations={payment.allocations} canReadTours={canReadTours} />
                          ) : (
                            <span className='mt-2 block font-medium text-red-700'>
                              Affectations incohérentes
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td data-label='Montant' className={`break-words px-2 py-3 text-xs font-bold sm:px-4 ${
                      payment.type === 'WITHDRAWAL'
                        ? 'text-red-800'
                        : 'text-emerald-800'
                    }`}>
                      {payment.amountInCentimes === null
                        ? 'Non calculable'
                        : `${payment.type === 'WITHDRAWAL' ? '−' : '+'} ${formatCashAmount(payment.amountInCentimes)}`}
                    </td>
                    <td data-label='Auteur' className='break-words px-2 py-3 text-xs text-slate-700 sm:px-4'>
                      {payment.author ?? 'Compte indisponible'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <nav
              aria-label='Pagination des mouvements de caisse'
              className='flex items-center justify-between gap-4 border-t border-slate-200 px-4 py-3 sm:px-6'
            >
              <PaginationLink disabled={page === 1} page={page - 1}>
                Précédent
              </PaginationLink>
              <p className='text-sm font-medium text-slate-600'>
                Page {page} sur {totalPages}
              </p>
              <PaginationLink
                disabled={page === totalPages}
                page={page + 1}
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
                : 'Aucun mouvement enregistré'}
            </h3>
            <p className='mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600'>
              {filtersActive
                ? 'Modifiez ou réinitialisez les critères de recherche.'
                : 'Les encaissements et retraits enregistrés apparaîtront ici.'}
            </p>
          </div>
        )}
      </section>
    </>
  );
};

export default CashJournal;
