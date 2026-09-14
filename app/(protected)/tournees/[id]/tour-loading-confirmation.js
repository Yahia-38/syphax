'use client';

import { useActionState, useMemo, useState } from 'react';

import ConfirmationDialog, {
  useFormConfirmation,
} from '../../confirmation-dialog.js';
import { formatReceptionMoney } from '../../../../lib/receptions.js';
import { loadTour } from './actions.js';

const LINES_PER_PAGE = 5;
const EMPTY_LINES = Object.freeze([]);

const INITIAL_STATE = {
  errors: {},
  message: null,
  replayed: false,
  revision: 0,
};

const formatQuantity = (quantity) => new Intl.NumberFormat('fr-DZ', {
  maximumFractionDigits: 0,
}).format(quantity);

const TourLoadingConfirmation = ({ preview, tourId }) => {
  const loadCurrentTour = loadTour.bind(null, tourId);
  const [state, formAction, pending] = useActionState(
    loadCurrentTour,
    INITIAL_STATE,
  );
  const {
    confirmSubmission,
    dialogRef,
    requestConfirmation,
    restoreTriggerFocus,
  } = useFormConfirmation();
  const [query, setQuery] = useState('');
  const [unit, setUnit] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const lines = preview?.lines ?? EMPTY_LINES;
  const normalizedQuery = query.trim().toLocaleLowerCase('fr');
  const availableUnits = useMemo(
    () => [...new Set(lines.map((line) => line.baseUnit))].sort(),
    [lines],
  );
  const filteredLines = useMemo(() => lines.filter((line) => {
    const matchesQuery = !normalizedQuery
      || line.productCode.toLocaleLowerCase('fr').includes(normalizedQuery)
      || line.productDesignation.toLocaleLowerCase('fr').includes(
        normalizedQuery,
      );

    return matchesQuery && (unit === 'ALL' || line.baseUnit === unit);
  }), [lines, normalizedQuery, unit]);
  const totalPages = Math.max(
    1,
    Math.ceil(filteredLines.length / LINES_PER_PAGE),
  );
  const activePage = Math.min(currentPage, totalPages);
  const firstLineIndex = (activePage - 1) * LINES_PER_PAGE;
  const paginatedLines = filteredLines.slice(
    firstLineIndex,
    firstLineIndex + LINES_PER_PAGE,
  );
  const unavailable = Boolean(preview?.errors?.form || !preview?.digest);

  return (
    <section className='mt-8 overflow-hidden rounded-2xl border border-blue-200 bg-blue-50 shadow-sm'>
      <div className='p-5 sm:p-6'>
        <h2 className='font-semibold text-slate-900'>Chargement complet</h2>
        <p className='mt-1 max-w-3xl text-sm leading-6 text-slate-700'>
          Vérifiez les quantités et les prix de vente TTC avant de confirmer.
          La valeur présentée décrit les marchandises chargées ; elle ne
          constitue ni une vente définitive, ni une dette, ni un encaissement.
        </p>
      </div>

      {preview?.errors?.form ? (
        <p className='mx-5 mb-5 rounded-lg border border-red-200 bg-white px-4 py-3 text-sm text-red-800 sm:mx-6 sm:mb-6' role='alert'>
          {preview.errors.form}
        </p>
      ) : (
        <>
          <div className='grid gap-4 border-y border-blue-200 bg-white/70 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-6' role='search'>
            <div>
              <label className='sr-only' htmlFor='loading-price-search'>
                Rechercher dans le récapitulatif de chargement
              </label>
              <input
                className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
                id='loading-price-search'
                maxLength={100}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setCurrentPage(1);
                }}
                placeholder='Rechercher par code ou désignation'
                type='search'
                value={query}
              />
            </div>
            <div>
              <label className='sr-only' htmlFor='loading-price-unit'>
                Filtrer par unité de base
              </label>
              <select
                className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 sm:w-48'
                id='loading-price-unit'
                onChange={(event) => {
                  setUnit(event.target.value);
                  setCurrentPage(1);
                }}
                value={unit}
              >
                <option value='ALL'>Toutes les unités</option>
                {availableUnits.map((availableUnit) => (
                  <option key={availableUnit} value={availableUnit}>
                    {availableUnit}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {paginatedLines.length > 0 ? (
            <div className='divide-y divide-blue-100 bg-white/40'>
              {paginatedLines.map((line) => (
                <article className='grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_repeat(3,auto)] sm:items-center sm:p-6' key={line.id}>
                  <div className='min-w-0'>
                    <p className='break-all font-mono text-sm font-semibold text-blue-700'>
                      {line.productCode}
                    </p>
                    <h3 className='mt-1 break-words font-semibold text-slate-900'>
                      {line.productDesignation}
                    </h3>
                  </div>
                  <div className='sm:text-right'>
                    <p className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
                      Quantité chargée
                    </p>
                    <p className='mt-1 font-semibold tabular-nums text-slate-900'>
                      {formatQuantity(line.quantityInBaseUnits)} {line.baseUnit}
                    </p>
                  </div>
                  <div className='sm:text-right'>
                    <p className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
                      Prix unitaire TTC
                    </p>
                    <p className='mt-1 font-semibold tabular-nums text-slate-900'>
                      {formatReceptionMoney(
                        line.salePriceAtLoading.amountInCentimes,
                      )} / {line.salePriceAtLoading.unit}
                    </p>
                  </div>
                  <div className='rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 sm:text-right'>
                    <p className='text-xs font-semibold uppercase tracking-wide text-blue-700'>
                      Valeur des marchandises chargées
                    </p>
                    <p className='mt-1 text-lg font-bold tabular-nums text-blue-950'>
                      {formatReceptionMoney(line.loadedValueInCentimes)}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className='bg-white/40 p-10 text-center'>
              <p className='font-semibold text-slate-900'>Aucune ligne trouvée</p>
              <p className='mt-1 text-sm text-slate-600'>
                Modifiez la recherche ou le filtre.
              </p>
            </div>
          )}

          <nav
            aria-label='Pagination du récapitulatif de chargement'
            className='flex items-center justify-between gap-4 border-t border-blue-200 bg-white/70 px-5 py-4 sm:px-6'
          >
            <button
              className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40'
              disabled={activePage === 1}
              onClick={() => setCurrentPage(activePage - 1)}
              type='button'
            >
              Précédent
            </button>
            <span className='text-sm text-slate-600'>
              Page {activePage} sur {totalPages}
            </span>
            <button
              className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40'
              disabled={activePage === totalPages}
              onClick={() => setCurrentPage(activePage + 1)}
              type='button'
            >
              Suivant
            </button>
          </nav>

          <div className='flex flex-col gap-5 border-t border-blue-200 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6'>
            <div>
              <p className='text-sm font-medium text-slate-700'>
                Valeur des marchandises chargées
              </p>
              <p className='mt-1 text-2xl font-bold tabular-nums text-blue-950'>
                {formatReceptionMoney(preview?.totalValueInCentimes)}
              </p>
            </div>
            <form
              action={formAction}
              onSubmit={requestConfirmation}
            >
              <input
                name='loadingDigest'
                type='hidden'
                value={preview?.digest ?? ''}
              />
              <button
                className='inline-flex w-full items-center justify-center rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto'
                disabled={pending || unavailable}
                type='submit'
              >
                {pending ? 'Confirmation…' : 'Confirmer le chargement'}
              </button>
              <ConfirmationDialog
                confirmLabel='Confirmer le chargement'
                dialogRef={dialogRef}
                onClose={restoreTriggerFocus}
                onConfirm={confirmSubmission}
                pending={pending}
                title='Confirmer ce chargement ?'
                tone='blue'
              >
                <p>
                  Vous allez confirmer le chargement complet de{' '}
                  <strong className='text-slate-950'>
                    {lines.length} ligne{lines.length > 1 ? 's' : ''}
                  </strong>.
                </p>
                <div className='rounded-xl bg-blue-50 p-4'>
                  <p className='text-xs font-semibold uppercase tracking-wide text-blue-700'>
                    Valeur des marchandises chargées
                  </p>
                  <p className='mt-1 text-xl font-bold text-blue-950'>
                    {formatReceptionMoney(preview?.totalValueInCentimes)}
                  </p>
                </div>
                <p>
                  Cette valeur n’est ni une vente définitive ni un encaissement.
                  Les lignes ne pourront plus être ajoutées ou retirées après
                  confirmation.
                </p>
              </ConfirmationDialog>
            </form>
          </div>
        </>
      )}

      {state.errors.form && (
        <p className='mx-5 mb-5 rounded-lg border border-red-200 bg-white px-4 py-3 text-sm text-red-800 sm:mx-6 sm:mb-6' role='alert'>
          {state.errors.form}
        </p>
      )}
      {state.message && (
        <p className='mx-5 mb-5 rounded-lg border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-800 sm:mx-6 sm:mb-6' role='status'>
          {state.message}
        </p>
      )}
    </section>
  );
};

export default TourLoadingConfirmation;
