'use client';

import { useActionState, useMemo, useState } from 'react';

import { formatReceptionMoney } from '../../../../lib/receptions.js';
import { calculateTourCounting } from '../../../../lib/tour-counting-calculations.js';
import { countTour } from './actions.js';

const LINES_PER_PAGE = 5;
const EMPTY_LINES = Object.freeze([]);
const INITIAL_STATE = {
  errors: {},
  message: null,
  replayed: false,
  revision: 0,
};

const formatQuantity = (quantity) => Number.isSafeInteger(quantity)
  ? new Intl.NumberFormat('fr-DZ', {
      maximumFractionDigits: 0,
    }).format(quantity)
  : 'Non calculable';

const TourCountingSheet = ({
  canConfirm,
  initialConfirmationKey,
  sheet,
  tourId,
}) => {
  const countCurrentTour = countTour.bind(null, tourId);
  const [state, formAction, pending] = useActionState(
    countCurrentTour,
    INITIAL_STATE,
  );
  const [opened, setOpened] = useState(Boolean(sheet?.recorded));
  const [returnedQuantities, setReturnedQuantities] = useState(() =>
    Object.fromEntries((sheet?.lines ?? EMPTY_LINES).map((line) => [
      line.id,
      Number.isSafeInteger(line.returnedQuantityInBaseUnits)
        ? String(line.returnedQuantityInBaseUnits)
        : '',
    ])));
  const [query, setQuery] = useState('');
  const [unit, setUnit] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const lines = sheet?.lines ?? EMPTY_LINES;
  const summary = useMemo(
    () => calculateTourCounting(lines, returnedQuantities),
    [lines, returnedQuantities],
  );
  const calculationsById = useMemo(
    () => new Map(summary.calculations.map((line) => [line.id, line])),
    [summary.calculations],
  );
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
  const confirmationRecap = lines.map((line) => {
    const calculation = calculationsById.get(line.id);

    return [
      `${line.productCode} — ${line.productDesignation}`,
      `chargé ${formatQuantity(line.quantityInBaseUnits)} ${line.baseUnit}`,
      `retourné ${formatQuantity(calculation?.returnedQuantityInBaseUnits)} ${line.baseUnit}`,
      `vendu ${formatQuantity(calculation?.soldQuantityInBaseUnits)} ${line.baseUnit}`,
      `${formatReceptionMoney(line.salePriceAtLoading?.amountInCentimes)} TTC / ${line.baseUnit}`,
      `dû ${formatReceptionMoney(calculation?.amountDueInCentimes)}`,
    ].join(' · ');
  }).join('\n');
  const confirmation = [
    'Enregistrer définitivement le comptage complet de cette tournée ?',
    '',
    confirmationRecap,
    '',
    `Total dû : ${formatReceptionMoney(summary.totalDueInCentimes)}`,
    '',
    'Cette confirmation constate la restitution physique des retours. Le comptage ne sera plus modifiable.',
  ].join('\n');
  const confirmationUnavailable = sheet?.recorded
    || !canConfirm
    || !summary.complete
    || !sheet?.digest;

  return (
    <section
      aria-labelledby='tour-counting-title'
      className='mt-8 overflow-hidden rounded-2xl border border-violet-200 bg-violet-50 shadow-sm'
    >
      <div className='flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6'>
        <div>
          <p className='text-xs font-semibold uppercase tracking-wide text-violet-700'>
            {sheet?.recorded ? 'Retour de tournée enregistré' : 'Retour de tournée'}
          </p>
          <h2 className='mt-1 text-lg font-semibold text-slate-900' id='tour-counting-title'>
            Feuille de comptage
          </h2>
          <p className='mt-2 max-w-3xl text-sm leading-6 text-slate-700'>
            Les retours correspondent aux marchandises physiquement restituées.
            Toute quantité chargée qui n’est pas retournée est considérée comme
            vendue {sheet?.recorded ? 'dans le comptage enregistré.' : 'dans cette prévisualisation.'}
          </p>
        </div>
        <button
          aria-expanded={opened}
          className='inline-flex w-full shrink-0 items-center justify-center rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-800 sm:w-auto'
          onClick={() => setOpened((currentValue) => !currentValue)}
          type='button'
        >
          {opened
            ? 'Masquer la feuille'
            : sheet?.recorded
              ? 'Afficher le comptage'
              : 'Préparer le comptage'}
        </button>
      </div>

      {opened && (
        <div className='border-t border-violet-200'>
          {sheet?.errors?.form ? (
            <p className='m-5 rounded-lg border border-red-200 bg-white px-4 py-3 text-sm text-red-800 sm:m-6' role='alert'>
              {sheet.errors.form}
            </p>
          ) : (
            <form
              action={formAction}
              onSubmit={(event) => {
                if (sheet?.recorded || !event.nativeEvent.submitter) {
                  event.preventDefault();
                  return;
                }

                if (
                  !globalThis.confirm(confirmation)
                ) {
                  event.preventDefault();
                }
              }}
            >
              <div className='border-b border-violet-200 bg-white/70 p-5 sm:p-6'>
                <p className='text-sm leading-6 text-slate-700'>
                  {sheet?.recorded
                    ? 'Ce comptage fait foi. Il est conservé en lecture seule et ne peut plus être modifié dans cet incrément.'
                    : 'Saisissez chaque retour en unité de base. Les champs sont volontairement vides : saisissez explicitement 0 lorsqu’aucun article n’a été retourné.'}
                </p>
              </div>

              <div className='grid gap-4 border-b border-violet-200 bg-white/70 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-6' role='search'>
                <div>
                  <label className='sr-only' htmlFor='counting-search'>
                    Rechercher dans la feuille de comptage
                  </label>
                  <input
                    className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100'
                    id='counting-search'
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
                  <label className='sr-only' htmlFor='counting-unit'>
                    Filtrer par unité de base
                  </label>
                  <select
                    className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100 sm:w-48'
                    id='counting-unit'
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
                <div className='divide-y divide-violet-100 bg-white/40'>
                  {paginatedLines.map((line) => {
                    const calculation = calculationsById.get(line.id);
                    const amountDueInCentimes = sheet?.recorded
                      ? line.amountDueInCentimes
                      : calculation?.amountDueInCentimes;
                    const soldQuantityInBaseUnits = sheet?.recorded
                      ? line.soldQuantityInBaseUnits
                      : calculation?.soldQuantityInBaseUnits;
                    const inputId = `returned-quantity-${line.id}`;
                    const errorId = `returned-quantity-error-${line.id}`;

                    return (
                      <article className='p-5 sm:p-6' key={line.id}>
                        <div className='min-w-0'>
                          <p className='break-all font-mono text-sm font-semibold text-violet-700'>
                            {line.productCode}
                          </p>
                          <h3 className='mt-1 break-words font-semibold text-slate-900'>
                            {line.productDesignation}
                          </h3>
                          <p className='mt-1 text-sm text-slate-600'>
                            Unité de base : <span className='font-semibold text-slate-800'>{line.baseUnit}</span>
                          </p>
                        </div>

                        <div className='mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5'>
                          <div className='rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3'>
                            <p className='text-xs font-semibold uppercase tracking-wide text-emerald-700'>
                              Quantité chargée
                            </p>
                            <p className='mt-1 text-lg font-bold tabular-nums text-emerald-950'>
                              {formatQuantity(line.quantityInBaseUnits)} {line.baseUnit}
                            </p>
                          </div>

                          <div className={`rounded-xl border bg-white px-4 py-3 ${calculation?.error ? 'border-red-300' : 'border-slate-200'}`}>
                            <label className='text-xs font-semibold uppercase tracking-wide text-slate-600' htmlFor={inputId}>
                              Quantité retournée
                            </label>
                            <div className='mt-2 flex items-center gap-2'>
                              <input
                                aria-describedby={calculation?.error ? errorId : undefined}
                                aria-invalid={Boolean(calculation?.error)}
                                className='min-w-0 w-full rounded-lg border border-slate-300 px-3 py-2 text-base font-semibold tabular-nums text-slate-900 outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100'
                                id={inputId}
                                inputMode='numeric'
                                onChange={(event) => setReturnedQuantities(
                                  (currentValues) => ({
                                    ...currentValues,
                                    [line.id]: event.target.value,
                                  }),
                                )}
                                placeholder='Ex. 0'
                                readOnly={sheet?.recorded}
                                type='text'
                                value={returnedQuantities[line.id] ?? ''}
                              />
                              <span className='shrink-0 text-sm font-medium text-slate-600'>
                                {line.baseUnit}
                              </span>
                            </div>
                          </div>

                          <div className='rounded-xl border border-slate-200 bg-slate-50 px-4 py-3'>
                            <p className='text-xs font-semibold uppercase tracking-wide text-slate-600'>
                              Quantité vendue
                            </p>
                            <p className='mt-1 text-lg font-bold tabular-nums text-slate-900'>
                              {Number.isSafeInteger(
                                soldQuantityInBaseUnits,
                              )
                                ? `${formatQuantity(soldQuantityInBaseUnits)} ${line.baseUnit}`
                                : 'Non calculable'}
                            </p>
                          </div>

                          <div className='rounded-xl border border-blue-100 bg-blue-50 px-4 py-3'>
                            <p className='text-xs font-semibold uppercase tracking-wide text-blue-700'>
                              Prix unitaire TTC historique
                            </p>
                            {calculation?.priceAvailable ? (
                              <p className='mt-1 text-lg font-bold tabular-nums text-blue-950'>
                                {formatReceptionMoney(
                                  line.salePriceAtLoading.amountInCentimes,
                                )} / {line.baseUnit}
                              </p>
                            ) : (
                              <p className='mt-1 text-sm font-semibold text-amber-900'>
                                Prix historique manquant ou inexploitable
                              </p>
                            )}
                          </div>

                          <div className='rounded-xl border border-violet-200 bg-violet-100 px-4 py-3'>
                            <p className='text-xs font-semibold uppercase tracking-wide text-violet-700'>
                              {sheet?.recorded ? 'Montant dû' : 'Montant dû prévu'}
                            </p>
                            <p className='mt-1 text-lg font-bold tabular-nums text-violet-950'>
                              {Number.isSafeInteger(
                                amountDueInCentimes,
                              )
                                ? formatReceptionMoney(
                                    amountDueInCentimes,
                                  )
                                : 'Non calculable'}
                            </p>
                          </div>
                        </div>

                        {calculation?.error ? (
                          <p className='mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800' id={errorId} role='alert'>
                            {calculation.error}
                          </p>
                        ) : !calculation?.inputComplete ? (
                          <p className='mt-3 text-sm font-medium text-amber-800'>
                            Retour non renseigné — saisissez 0 si aucun produit
                            n’a été restitué.
                          </p>
                        ) : !calculation.priceAvailable ? (
                          <p className='mt-3 text-sm font-medium text-amber-800'>
                            Les quantités sont prévisualisées, mais le montant
                            reste non calculable sans prix historique.
                          </p>
                        ) : null}
                      </article>
                    );
                  })}
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
                aria-label='Pagination de la feuille de comptage'
                className='flex items-center justify-between gap-4 border-t border-violet-200 bg-white/70 px-5 py-4 sm:px-6'
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

              <div className='border-t border-violet-200 p-5 sm:p-6'>
                <div className='rounded-xl border border-violet-200 bg-white px-4 py-4'>
                  <p className='text-xs font-semibold uppercase tracking-wide text-violet-700'>
                    {summary.complete
                      ? sheet?.recorded
                        ? 'Total dû enregistré pour la tournée'
                        : 'Total prévu pour la tournée'
                      : 'Prévisualisation incomplète'}
                  </p>
                  {summary.complete ? (
                    <p className='mt-1 text-2xl font-bold tabular-nums text-violet-950'>
                      {formatReceptionMoney(
                        sheet?.recorded
                          ? sheet.totalDueInCentimes
                          : summary.totalDueInCentimes,
                      )}
                    </p>
                  ) : Number.isSafeInteger(summary.knownSubtotalInCentimes) ? (
                    <>
                      <p className='mt-2 text-sm font-medium text-slate-600'>
                        Sous-total connu ({summary.knownAmountLineCount} sur{' '}
                        {lines.length} ligne{lines.length > 1 ? 's' : ''})
                      </p>
                      <p className='mt-1 text-2xl font-bold tabular-nums text-violet-950'>
                        {formatReceptionMoney(summary.knownSubtotalInCentimes)}
                      </p>
                    </>
                  ) : (
                    <p className='mt-2 text-sm font-medium text-slate-700'>
                      Aucun montant calculable pour le moment.
                    </p>
                  )}
                  {!summary.complete && (
                    <p className='mt-3 text-sm leading-6 text-slate-600'>
                      Aucun total complet n’est présenté tant qu’une ligne est
                      vide ou invalide, qu’un prix historique manque, ou qu’une
                      limite numérique est dépassée.
                    </p>
                  )}
                  {summary.subtotalOverflow && (
                    <p className='mt-3 text-sm font-medium text-red-800' role='alert'>
                      Le sous-total dépasse la limite numérique autorisée.
                    </p>
                  )}
                </div>

                <div className='mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                  <p className='max-w-2xl text-sm leading-6 text-slate-600'>
                    {sheet?.recorded
                      ? `Comptage enregistré${sheet.countedBy ? ` par ${sheet.countedBy}` : ''}. Les retours physiques sont intégrés au stock ; aucun encaissement ou compte financier n’a été créé.`
                      : 'La confirmation constate la restitution physique des retours et réintègre ceux-ci au stock. Le comptage ne sera plus modifiable dans cet incrément.'}
                  </p>
                  {!sheet?.recorded && (
                    <>
                      <input
                        name='confirmationKey'
                        type='hidden'
                        value={initialConfirmationKey}
                      />
                      <input
                        name='countingSheetDigest'
                        type='hidden'
                        value={sheet?.digest ?? ''}
                      />
                      {lines.map((line) => (
                        <span key={line.id}>
                          <input name='lineId' type='hidden' value={line.id} />
                          <input
                            name='returnedQuantity'
                            type='hidden'
                            value={returnedQuantities[line.id] ?? ''}
                          />
                        </span>
                      ))}
                      <button
                        className='inline-flex w-full items-center justify-center rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto'
                        disabled={pending || confirmationUnavailable}
                        type='submit'
                      >
                        {pending ? 'Enregistrement…' : 'Enregistrer le comptage'}
                      </button>
                    </>
                  )}
                </div>
                {!sheet?.recorded && !canConfirm && (
                  <p className='mt-4 text-sm font-medium text-amber-800'>
                    La permission d’enregistrer le comptage est requise.
                  </p>
                )}
                {state.errors.form && (
                  <p className='mt-4 rounded-lg border border-red-200 bg-white px-4 py-3 text-sm text-red-800' role='alert'>
                    {state.errors.form}
                  </p>
                )}
                {state.message && (
                  <p className='mt-4 rounded-lg border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-800' role='status'>
                    {state.message}
                  </p>
                )}
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
};

export default TourCountingSheet;
