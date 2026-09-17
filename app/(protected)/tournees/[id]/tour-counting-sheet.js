'use client';

import { TourFormActions, useTourActionState, useTourDraft } from './tour-operation-context.js';

import { useEffect, useMemo, useState } from 'react';

import ConfirmationDialog, {
  useFormConfirmation,
} from '../../confirmation-dialog.js';
import {
  formatQuantityInDisplayUnit,
  getLineUnitOptions,
} from '../../../../lib/product-display-unit.js';
import { formatReceptionMoney } from '../../../../lib/receptions.js';
import { calculateTourCounting } from '../../../../lib/tour-counting-calculations.js';
import { calculateCountingPurchaseCosts } from '../../../../lib/tour-counting-purchase-costs.js';
import { countTour } from './actions.js';

const LINES_PER_PAGE = 5;
const EMPTY_LINES = Object.freeze([]);
const INITIAL_STATE = {
  errors: {},
  message: null,
  replayed: false,
  revision: 0,
};

const TourCountingSheet = ({
  canConfirm,
  initialConfirmationKey,
  sheet,
  tourId,
  embedded = false,
}) => {
  const countCurrentTour = countTour.bind(null, tourId);
  const [state, formAction, pending] = useTourActionState(
    countCurrentTour,
    INITIAL_STATE,
  );
  const {
    confirmSubmission,
    dialogRef,
    requestConfirmation,
    restoreTriggerFocus,
  } = useFormConfirmation();
  const [opened, setOpened] = useState(embedded);
  const [returnedQuantities, setReturnedQuantities] = useState(() =>
    Object.fromEntries((sheet?.lines ?? EMPTY_LINES).map((line) => [
      line.id,
      Number.isSafeInteger(line.returnedQuantityInBaseUnits)
        ? String(line.returnedQuantityInBaseUnits)
        : '',
    ])));
  useTourDraft(returnedQuantities);
  const [focusLineId, setFocusLineId] = useState(null);
  useEffect(() => {
    if (!focusLineId) return;
    document.getElementById(`returned-quantity-${focusLineId.id}`)?.focus();

  }, [focusLineId]);
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
  const includeValuation = lines.some((line) => 'purchaseCostAtLoading' in line);
  const purchaseSummary = useMemo(
    () => calculateCountingPurchaseCosts(lines, summary.calculations),
    [lines, summary.calculations],
  );
  const purchaseCostsById = useMemo(
    () => new Map(purchaseSummary.lines.map((line) => [line.id, line])),
    [purchaseSummary.lines],
  );
  const purchaseTotals = sheet?.recorded ? sheet : purchaseSummary;
  const purchaseComplete = sheet?.recorded
    ? Number.isSafeInteger(sheet.totalPurchaseCostInCentimes)
      && Number.isSafeInteger(sheet.totalReturnedValueInCentimes)
      && Number.isSafeInteger(sheet.totalCostOfGoodsSoldInCentimes)
    : purchaseSummary.complete;
  const renderPurchaseTotals = () => includeValuation && (
    <div className='mt-3 text-sm leading-6 text-slate-700'>
      {purchaseComplete ? (
        <>
          <p>Coût d’achat chargé : {formatReceptionMoney(purchaseTotals.totalPurchaseCostInCentimes)}</p>
          <p>Valeur d’achat retournée : {formatReceptionMoney(purchaseTotals.totalReturnedValueInCentimes)}</p>
          <p>Coût des marchandises vendues : {formatReceptionMoney(purchaseTotals.totalCostOfGoodsSoldInCentimes)}</p>
        </>
      ) : <p>{sheet?.recorded ? 'Coûts historiques incomplets · migration requise.' : 'La répartition du coût d’achat nécessite un retour valide pour chaque ligne.'}</p>}
    </div>
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
  const confirmationUnavailable = sheet?.recorded
    || !canConfirm
    || !summary.complete
    || !sheet?.digest
    || (includeValuation && !purchaseSummary.complete);

  return (
    <section
      aria-labelledby={embedded ? undefined : 'tour-counting-title'} aria-label={embedded ? 'Comptage et retours' : undefined}
      className={embedded ? 'tour-embedded' : 'mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm'}
    >
      {!embedded && <div className='flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6'>
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
      </div>}

      {opened && (
        <div className='border-t border-violet-200'>
          {sheet?.errors?.form ? (
            <p className='m-5 rounded-lg border border-red-200 bg-white px-4 py-3 text-sm text-red-800 sm:m-6' role='alert' tabIndex={-1}>
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

                requestConfirmation(event);
              }}
            >
              <div className='border-b border-violet-200 bg-white/70 p-5 sm:p-6'>
                <p className='text-sm leading-6 text-slate-700'>
                  {sheet?.recorded
                    ? 'Ce comptage fait foi. Il est conservé en lecture seule et ne peut plus être modifié après enregistrement.'
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
                  <div className='tour-counting-columns' aria-hidden='true'><span>Produit</span><div><span>Chargé</span><span>Retourné</span><span>Vendu</span><span>Ventes TTC</span></div></div>
                  {paginatedLines.map((line) => {
                    const calculation = calculationsById.get(line.id);
                    const amountDueInCentimes = sheet?.recorded
                      ? line.amountDueInCentimes
                      : calculation?.amountDueInCentimes;
                    const soldQuantityInBaseUnits = sheet?.recorded
                      ? line.soldQuantityInBaseUnits
                      : calculation?.soldQuantityInBaseUnits;
                    const purchaseCost = sheet?.recorded ? line : purchaseCostsById.get(line.id);
                    const inputId = `returned-quantity-${line.id}`;
                    const errorId = `returned-quantity-error-${line.id}`;

                    return (
                      <article className='tour-counting-line p-4' key={line.id}>
                        <div className='tour-counting-product min-w-0'>
                          <h3 className='break-words font-semibold text-slate-900'>{line.productDesignation}</h3>
                          <p className='mt-1 text-sm text-slate-600'>{line.productCode} · retours en {getLineUnitOptions(line).baseUnitLabel.toLocaleLowerCase('fr')}</p>
                          <p className='mt-1 text-xs text-slate-500'>
                            {calculation?.priceAvailable
                              ? `Prix TTC figé : ${formatReceptionMoney(line.salePriceAtLoading.amountInCentimes)} / ${getLineUnitOptions(line).baseUnitLabel.toLocaleLowerCase('fr')}`
                              : 'Prix historique manquant ou inexploitable'}
                          </p>
                        </div>
                        <div className='tour-counting-quantities'>
                          <div><p className='tour-counting-label'>Chargé</p><p className='tabular-nums'>{formatQuantityInDisplayUnit(line.quantityInBaseUnits, getLineUnitOptions(line))}</p></div>
                          <div>
                            <label className='tour-counting-label' htmlFor={inputId}>Retourné<span className='sr-only'> · {line.productDesignation} en {getLineUnitOptions(line).baseUnitLabel.toLocaleLowerCase('fr')}</span></label>
                            <input
                              aria-describedby={calculation?.error ? errorId : undefined}
                              aria-invalid={Boolean(calculation?.error)}
                              className='w-full rounded-lg border border-slate-300 px-3 py-2 text-base font-semibold tabular-nums text-slate-900 outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100'
                              id={inputId} data-autofocus disabled={pending} inputMode='numeric'
                              onChange={(event) => setReturnedQuantities((currentValues) => ({ ...currentValues, [line.id]: event.target.value }))}
                              placeholder='À saisir' readOnly={sheet?.recorded} type='text' value={returnedQuantities[line.id] ?? ''}
                            />
                            {line.displayUnit && /^\d+$/u.test((returnedQuantities[line.id] ?? '').trim())
                              && Number(returnedQuantities[line.id].trim()) >= line.displayUnit.quantity && (
                              <p className='mt-1 text-xs tabular-nums text-slate-600'>
                                = {formatQuantityInDisplayUnit(Number(returnedQuantities[line.id].trim()), getLineUnitOptions(line))}
                              </p>
                            )}
                          </div>
                          <div><p className='tour-counting-label'>Vendu</p><p className='tabular-nums'>{Number.isSafeInteger(soldQuantityInBaseUnits) ? formatQuantityInDisplayUnit(soldQuantityInBaseUnits, getLineUnitOptions(line)) : '—'}<span className='sr-only'>{!Number.isSafeInteger(soldQuantityInBaseUnits) ? 'Non calculable' : ''}</span></p></div>
                          <div><p className='tour-counting-label'>{sheet?.recorded ? 'Ventes TTC' : 'Ventes TTC prévues'}</p><p className='font-semibold tabular-nums'>{Number.isSafeInteger(amountDueInCentimes) ? formatReceptionMoney(amountDueInCentimes) : '—'}<span className='sr-only'>{!Number.isSafeInteger(amountDueInCentimes) ? 'Non calculable' : ''}</span></p></div>
                        </div>

                        {'purchaseCostAtLoading' in line && (
                          <div className='text-sm leading-6 text-slate-700 sm:col-span-2'>
                            {line.purchaseCostAtLoading ? (
                              <p>Coût d’achat chargé : {formatReceptionMoney(line.purchaseCostAtLoading.valueInCentimes)}</p>
                            ) : <p>Coût d’achat historique manquant · migration requise.</p>}
                            {Number.isSafeInteger(purchaseCost?.returnedValueInCentimes) && (
                              <p>Valeur d’achat retournée : {formatReceptionMoney(purchaseCost.returnedValueInCentimes)} · Coût des marchandises vendues : {formatReceptionMoney(purchaseCost.costOfGoodsSoldInCentimes)}</p>
                            )}
                          </div>
                        )}
                        {calculation?.error ? (
                          <p className='mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800' id={errorId} role='alert' tabIndex={-1}>
                            {calculation.error}
                          </p>
                        ) : calculation?.inputComplete && !calculation.priceAvailable ? (
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
              {!sheet?.recorded && <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
                <p className='text-sm font-semibold text-violet-800'>{summary.knownAmountLineCount} / {lines.length} lignes complètes</p>
                <button type='button' disabled={pending || summary.complete} className='rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold' onClick={() => {
                  const next = summary.calculations.find((line) => !Number.isSafeInteger(line.amountDueInCentimes));
                  if (!next) return;
                  setQuery(''); setUnit('ALL');
                  setCurrentPage(Math.floor(lines.findIndex((line) => line.id === next.id) / LINES_PER_PAGE) + 1);
                  setFocusLineId({ id: next.id });
                }}>Prochaine ligne à compléter</button>
              </div>}
                <div className='rounded-xl border border-violet-200 bg-white px-4 py-4'>
                  <p className='text-xs font-semibold uppercase tracking-wide text-violet-700'>
                    {summary.complete
                      ? sheet?.recorded
                        ? 'Total dû enregistré pour la tournée'
                        : 'Prévisualisation · ventes brutes'
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
                        Sous-total partiel connu ({summary.knownAmountLineCount} sur{' '}
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
                  {renderPurchaseTotals()}
                  {!summary.complete && (
                    <p className='mt-3 text-sm leading-6 text-slate-600'>
                      Le total nécessite tous les retours et des prix historiques
                      exploitables, dans les limites numériques autorisées.
                    </p>
                  )}
                  {summary.subtotalOverflow && (
                    <p className='mt-3 text-sm font-medium text-red-800' role='alert' tabIndex={-1}>
                      Le sous-total dépasse la limite numérique autorisée.
                    </p>
                  )}
                </div>

                <div className='mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                  <p className='max-w-2xl text-sm leading-6 text-slate-600'>
                    {sheet?.recorded
                      ? `Comptage enregistré${sheet.countedBy ? ` par ${sheet.countedBy}` : ''}. Les retours physiques sont intégrés au stock ; aucun encaissement ou compte financier n’a été créé.`
                      : 'La confirmation constate la restitution physique des retours et réintègre ceux-ci au stock. Le comptage ne sera plus modifiable après enregistrement.'}
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
                      <div hidden>{lines.map((line) => (
                        <span key={line.id}>
                          <input name='lineId' type='hidden' value={line.id} />
                          <input
                            name='returnedQuantity'
                            type='hidden'
                            value={returnedQuantities[line.id] ?? ''}
                          />
                        </span>
                      ))}</div>
                      <TourFormActions pending={pending}><button
                        className='inline-flex w-full items-center justify-center rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto'
                        disabled={pending || confirmationUnavailable}
                        type='submit'
                      >
                        {pending ? 'Enregistrement…' : 'Enregistrer le comptage'}
                      </button></TourFormActions>
                      <ConfirmationDialog
                        confirmLabel='Enregistrer définitivement'
                        dialogRef={dialogRef}
                        onClose={restoreTriggerFocus}
                        onConfirm={confirmSubmission}
                        pending={pending}
                        pendingLabel='Enregistrement…'
                        title='Enregistrer ce comptage ?'
                        tone='violet'
                      >
                        <p>
                          Tournée {sheet?.tourReference} · {sheet?.deliverer?.code} — {sheet?.deliverer?.name}. Vous allez enregistrer définitivement le comptage de{' '}
                          <strong className='text-slate-950'>
                            {lines.length} ligne{lines.length > 1 ? 's' : ''}
                          </strong>.
                        </p>
                        <div className='rounded-xl bg-violet-50 p-4'>
                          <p className='text-xs font-semibold uppercase tracking-wide text-violet-700'>
                            Total dû calculé
                          </p>
                          <p className='mt-1 text-xl font-bold text-violet-950'>
                            {formatReceptionMoney(summary.totalDueInCentimes)}
                          </p>
                        </div>
                        {renderPurchaseTotals()}
                        <p>
                          Cette confirmation constate la restitution physique
                          des retours. Le comptage ne sera plus modifiable.
                        </p>
                      </ConfirmationDialog>
                    </>
                  )}
                </div>
                {!sheet?.recorded && !canConfirm && (
                  <p className='mt-4 text-sm font-medium text-amber-800'>
                    La permission d’enregistrer le comptage est requise.
                  </p>
                )}
                {state.errors.form && (
                  <p className='mt-4 rounded-lg border border-red-200 bg-white px-4 py-3 text-sm text-red-800' role='alert' tabIndex={-1}>
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
