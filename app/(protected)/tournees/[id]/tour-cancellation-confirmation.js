'use client';

import { useTourActionState, useTourDraft } from './tour-operation-context.js';

import { useMemo, useState } from 'react';

import ConfirmationDialog, {
  useFormConfirmation,
} from '../../confirmation-dialog.js';
import {
  formatQuantityInDisplayUnit,
  getLineUnitOptions,
} from '../../../../lib/product-display-unit.js';
import { cancelCurrentTour } from './actions.js';

const LINES_PER_PAGE = 3;
const EMPTY_LINES = Object.freeze([]);

const INITIAL_STATE = {
  errors: {},
  message: null,
  replayed: false,
  revision: 0,
  stale: false,
  succeeded: false,
};

const TourCancellationConfirmation = ({ preview, tourId, embedded = false }) => {
  const cancelSelectedTour = cancelCurrentTour.bind(null, tourId);
  const [state, formAction, pending] = useTourActionState(
    cancelSelectedTour,
    INITIAL_STATE,
  );
  const {
    confirmSubmission,
    dialogRef,
    requestConfirmation,
    restoreTriggerFocus,
  } = useFormConfirmation();
  const [reason, setReason] = useState('');
  useTourDraft({ reason });
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
    <section className={embedded ? 'tour-embedded p-5' : 'mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6'}>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
        {!embedded && <div>
          <h2 className='font-semibold text-slate-900'>Annulation</h2>
          <p className='mt-1 max-w-3xl text-sm leading-6 text-slate-700'>
            Annulez cette tournée en préparation et libérez toutes ses
            réservations actives sans modifier le stock physique.
          </p>
        </div>}

        <form action={formAction} className='w-full' onSubmit={requestConfirmation}>
            <div>
              <label
                className='font-semibold text-slate-900'
                htmlFor='cancellation-reason'
              >
                Motif d’annulation
              </label>
              <textarea
                aria-invalid={Boolean(state.errors.reason)} aria-describedby={state.errors.reason ? 'cancellation-reason-error' : undefined} disabled={pending} className='mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100'
                id='cancellation-reason'
                maxLength={500}
                name='cancellationReason'
                onChange={(event) => setReason(event.target.value)}
                placeholder='Expliquez pourquoi cette tournée est annulée'
                required
                rows={3}
                value={reason}
              />
            </div>

          {state.errors.reason && <p id='cancellation-reason-error' role='alert' tabIndex={-1}>{state.errors.reason}</p>}

          <input
            name='cancellationDigest'
            type='hidden'
            value={preview?.digest ?? ''}
          />
          <button
            className='inline-flex w-full items-center justify-center rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto'
            disabled={pending || unavailable}
            type='submit'
          >
            {pending ? 'Annulation…' : 'Annuler la tournée'}
          </button>

          <ConfirmationDialog
            confirmDisabled={!reason.trim()}
            confirmLabel='Annuler la tournée'
            dialogRef={dialogRef}
            onClose={restoreTriggerFocus}
            onConfirm={confirmSubmission}
            pending={pending}
            pendingLabel='Annulation…'
            title='Annuler définitivement cette tournée ?'
            tone='red'
          >
            <div className='rounded-xl bg-red-50 p-3'>
              <p>
                Référence : <strong className='text-slate-950'>
                  {preview?.tourReference}
                </strong>
              </p>
              <p>
                Livreur : <strong className='text-slate-950'>
                  {preview?.deliverer?.code} — {preview?.deliverer?.name}
                </strong>
              </p>
            </div>

            {lines.length > 0 ? (
              <>
                <p className='font-semibold text-slate-900'>
                  Produits et quantités à libérer
                </p>
                <div className='grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]'>
                  <div>
                    <label className='sr-only' htmlFor='cancellation-line-search'>
                      Rechercher un produit à libérer
                    </label>
                    <input
                      className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100'
                      id='cancellation-line-search'
                      maxLength={100}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setCurrentPage(1);
                      }}
                      placeholder='Code ou désignation'
                      type='search'
                      value={query}
                    />
                  </div>
                  <div>
                    <label className='sr-only' htmlFor='cancellation-unit-filter'>
                      Filtrer par unité
                    </label>
                    <select
                      className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100 sm:w-36'
                      id='cancellation-unit-filter'
                      onChange={(event) => {
                        setUnit(event.target.value);
                        setCurrentPage(1);
                      }}
                      value={unit}
                    >
                      <option value='ALL'>Toutes unités</option>
                      {availableUnits.map((availableUnit) => (
                        <option key={availableUnit} value={availableUnit}>
                          {availableUnit}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {paginatedLines.length > 0 ? (
                  <div className='divide-y divide-red-100 rounded-xl border border-red-100 bg-white'>
                    {paginatedLines.map((line) => (
                      <article className='flex items-start justify-between gap-3 p-3' key={line.id}>
                        <div className='min-w-0'>
                          <p className='break-all font-mono text-xs font-semibold text-red-700'>
                            {line.productCode}
                          </p>
                          <p className='break-words font-medium text-slate-900'>
                            {line.productDesignation}
                          </p>
                        </div>
                        <strong className='shrink-0 tabular-nums text-slate-950'>
                          {formatQuantityInDisplayUnit(line.quantityInBaseUnits, getLineUnitOptions(line))}
                        </strong>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className='rounded-lg bg-slate-50 p-3 text-center'>
                    Aucun produit ne correspond aux filtres.
                  </p>
                )}
                <nav
                  aria-label='Pagination des produits à libérer'
                  className='flex items-center justify-between gap-3'
                >
                  <button
                    className='rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 disabled:opacity-40'
                    disabled={activePage === 1}
                    onClick={() => setCurrentPage(activePage - 1)}
                    type='button'
                  >
                    Précédent
                  </button>
                  <span>Page {activePage} sur {totalPages}</span>
                  <button
                    className='rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 disabled:opacity-40'
                    disabled={activePage === totalPages}
                    onClick={() => setCurrentPage(activePage + 1)}
                    type='button'
                  >
                    Suivant
                  </button>
                </nav>
              </>
            ) : (
              <p className='rounded-xl border border-slate-200 bg-white p-3'>
                Cette tournée est vide : aucune réservation ne sera libérée.
              </p>
            )}

            <p className='whitespace-pre-wrap'><strong>Motif :</strong> {reason}</p>
          </ConfirmationDialog>
        </form>
      </div>

      {preview?.errors?.form && (
        <p className='mt-4 rounded-lg border border-red-200 bg-white px-4 py-3 text-sm text-red-800' role='alert' tabIndex={-1}>
          {preview.errors.form}
        </p>
      )}
      {(state.errors.form || state.errors.reason) && (
        <p className='mt-4 rounded-lg border border-red-200 bg-white px-4 py-3 text-sm text-red-800' role='alert' tabIndex={-1}>
          {state.errors.form ?? state.errors.reason}
        </p>
      )}
      {state.message && (
        <p className='mt-4 rounded-lg border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-800' role='status'>
          {state.message}
        </p>
      )}
    </section>
  );
};

export default TourCancellationConfirmation;
