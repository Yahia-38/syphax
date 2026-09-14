'use client';

import { useMemo, useRef, useState, useTransition } from 'react';

import { calculateDelivererCashAllocationPreview } from '../../../lib/cash-payment-calculations.js';
import { formatReceptionMoney } from '../../../lib/receptions.js';
import { recordDelivererPayment } from '../cash-payment-actions.js';
import ConfirmationDialog, {
  useFormConfirmation,
} from '../confirmation-dialog.js';

const ALLOCATIONS_PER_PAGE = 5;
const REQUEST_FIELD_NAMES = Object.freeze([
  'amount',
  'confirmationKey',
  'delivererId',
  'expectedCashRegisterId',
  'expectedSummary',
  'note',
]);

const formatCountingDate = (value) => {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? 'Date indisponible'
    : new Intl.DateTimeFormat('fr-DZ', {
        dateStyle: 'medium',
        hourCycle: 'h23',
        timeStyle: 'short',
        timeZone: 'Africa/Algiers',
      }).format(date);
};

const freezePaymentRequest = (formData) => Object.fromEntries(
  REQUEST_FIELD_NAMES.map((name) => {
    const value = formData.get(name);
    return [name, typeof value === 'string' ? value : ''];
  }),
);

const createPaymentFormData = (request) => {
  const formData = new FormData();

  for (const name of REQUEST_FIELD_NAMES) {
    formData.set(name, request[name]);
  }

  return formData;
};

const DelivererCashAllocationPreview = ({
  cashRegister,
  confirmationKey,
  onClose,
  onResolved,
  remainder,
}) => {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [actionState, setActionState] = useState(null);
  const [frozenRequest, setFrozenRequest] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [transitionPending, startTransition] = useTransition();
  const submissionInFlightRef = useRef(false);
  const {
    confirmSubmission,
    dialogRef,
    requestConfirmation,
    restoreTriggerFocus,
  } = useFormConfirmation();
  const calculatedPreview = useMemo(() =>
    calculateDelivererCashAllocationPreview({
      amount,
      blockingAnomalies: remainder.blockingAnomalies,
      tours: remainder.tours,
    }), [amount, remainder.blockingAnomalies, remainder.tours]);
  const preview = actionState?.stale && actionState.summary
    ? actionState.summary
    : calculatedPreview;
  const pending = submitting || transitionPending;
  const uncertain = Boolean(actionState?.uncertain && frozenRequest);
  const previewIsComplete = Boolean(
    cashRegister
    && !preview.blocked
    && !preview.error
    && Number.isSafeInteger(preview.amountInCentimes)
    && preview.amountInCentimes > 0
    && preview.totalAllocatedInCentimes === preview.amountInCentimes
    && Array.isArray(preview.allocations)
    && preview.allocations.length > 0,
  );
  const normalizedQuery = query.trim().toLocaleLowerCase('fr');
  const filteredAllocations = preview.allocations.filter((allocation) =>
    !normalizedQuery
    || allocation.tourReference.toLocaleLowerCase('fr').includes(
      normalizedQuery,
    ));
  const totalPages = Math.max(
    1,
    Math.ceil(filteredAllocations.length / ALLOCATIONS_PER_PAGE),
  );
  const activePage = Math.min(page, totalPages);
  const paginatedAllocations = filteredAllocations.slice(
    (activePage - 1) * ALLOCATIONS_PER_PAGE,
    activePage * ALLOCATIONS_PER_PAGE,
  );

  const clearResolvedState = () => {
    if (!uncertain) {
      setActionState(null);
      setFrozenRequest(null);
    }
  };

  const runPaymentRequest = (request) => {
    if (submissionInFlightRef.current) {
      return;
    }

    submissionInFlightRef.current = true;
    setFrozenRequest(request);
    setSubmitting(true);

    startTransition(async () => {
      try {
        const result = await recordDelivererPayment(
          createPaymentFormData(request),
        );

        if (result.succeeded) {
          onResolved({
            message: `${result.message} Montant encaissé : ${formatReceptionMoney(result.payment.amountInCentimes)}.`,
            nextConfirmationKey: result.nextConfirmationKey,
            paymentReference: result.payment.reference,
          });
          onClose();
          return;
        }

        setActionState(result);

        if (!result.uncertain) {
          setFrozenRequest(null);
        }
      } catch (error) {
        console.error('Réponse introuvable du versement global :', error);
        setActionState({
          errors: {
            form: 'La réponse n’a pas été reçue. Le versement peut avoir été enregistré.',
          },
          stale: false,
          succeeded: false,
          uncertain: true,
        });
      } finally {
        submissionInFlightRef.current = false;
        setSubmitting(false);
      }
    });
  };

  const submitPayment = (formData) => {
    if (!previewIsComplete || uncertain) {
      return;
    }

    runPaymentRequest(freezePaymentRequest(formData));
  };

  return (
    <div
      aria-labelledby='deliverer-payment-preview-title'
      aria-modal='true'
      className='fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4'
      role='dialog'
    >
      <div className='max-h-[calc(100vh-2rem)] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-2xl'>
        <div className='flex items-start justify-between gap-4 border-b border-slate-200 p-5 sm:p-6'>
          <div>
            <p className='text-xs font-semibold uppercase tracking-wide text-amber-700'>
              Encaissement multi-tournées
            </p>
            <h2 className='mt-1 text-xl font-semibold text-slate-950' id='deliverer-payment-preview-title'>
              Encaisser le livreur
            </h2>
          </div>
          <button
            aria-label='Fermer la fenêtre d’encaissement'
            className='rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'
            disabled={pending || uncertain}
            onClick={onClose}
            type='button'
          >
            Fermer
          </button>
        </div>

        <dl className='grid gap-px bg-slate-200 sm:grid-cols-3'>
          <div className='min-w-0 bg-white px-5 py-4 sm:px-6'>
            <dt className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
              Livreur
            </dt>
            <dd className='mt-1 break-words text-sm font-semibold text-slate-950'>
              {remainder.deliverer.code} — {remainder.deliverer.name || 'Nom non renseigné'}
            </dd>
          </div>
          <div className='min-w-0 bg-white px-5 py-4 sm:px-6'>
            <dt className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
              Caisse destinataire
            </dt>
            <dd className='mt-1 break-words text-sm font-semibold text-slate-950'>
              {cashRegister
                ? `${cashRegister.name} (${cashRegister.code}, DZD)`
                : 'Caisse indisponible'}
            </dd>
          </div>
          <div className='min-w-0 bg-white px-5 py-4 sm:px-6'>
            <dt className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
              Reste total actuel
            </dt>
            <dd className='mt-1 text-xl font-bold tabular-nums text-slate-950'>
              {remainder.blockingAnomalies.length > 0
                ? 'Non calculable'
                : formatReceptionMoney(remainder.remainingDueInCentimes)}
            </dd>
          </div>
        </dl>

        <form
          action={submitPayment}
          className='p-5 sm:p-6'
          onSubmit={(event) => {
            if (!previewIsComplete || pending || uncertain) {
              event.preventDefault();
              return;
            }

            requestConfirmation(event);
          }}
        >
          <div className='grid gap-5 lg:grid-cols-2'>
            <div>
              <label className='text-sm font-semibold text-slate-800' htmlFor='deliverer-payment-amount'>
                Montant réellement reçu en DA
              </label>
              <input
                aria-describedby={preview.error || actionState?.errors?.amount
                  ? 'deliverer-payment-error'
                  : undefined}
                aria-invalid={Boolean(preview.error || actionState?.errors?.amount)}
                autoFocus
                className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-100 disabled:bg-slate-100'
                disabled={pending || uncertain}
                id='deliverer-payment-amount'
                inputMode='decimal'
                name='amount'
                onChange={(event) => {
                  setAmount(event.target.value);
                  setPage(1);
                  clearResolvedState();
                }}
                placeholder='Ex. 5000'
                type='text'
                value={amount}
              />
            </div>
            <div>
              <label className='text-sm font-semibold text-slate-800' htmlFor='deliverer-payment-note'>
                Note facultative
              </label>
              <textarea
                aria-describedby={actionState?.errors?.note
                  ? 'deliverer-payment-note-error'
                  : undefined}
                aria-invalid={Boolean(actionState?.errors?.note)}
                className='mt-2 min-h-24 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-100 disabled:bg-slate-100'
                disabled={pending || uncertain}
                id='deliverer-payment-note'
                maxLength={500}
                name='note'
                onChange={(event) => {
                  setNote(event.target.value);
                  clearResolvedState();
                }}
                placeholder='Précision sur la remise d’espèces'
                value={note}
              />
              {actionState?.errors?.note && (
                <p className='mt-2 text-sm font-medium text-red-700' id='deliverer-payment-note-error' role='alert'>
                  {actionState.errors.note}
                </p>
              )}
            </div>
          </div>

          {remainder.blockingAnomalies.length > 0 && (
            <aside className='mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-900'>
              <h3 className='font-semibold'>Prévisualisation globale impossible</h3>
              <p className='mt-1 leading-6'>
                Toutes les tournées doivent être financièrement cohérentes avant de calculer une répartition.
              </p>
              {remainder.blockingAnomalies.map((anomaly) => (
                <p className='mt-2' key={`${anomaly.code}-${anomaly.tourReference}`}>
                  {anomaly.label} : {anomaly.tourReference}
                </p>
              ))}
            </aside>
          )}

          {(preview.error || actionState?.errors?.amount) && (
            <p className='mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800' id='deliverer-payment-error' role='alert'>
              {actionState?.errors?.amount ?? preview.error}
            </p>
          )}

          {!preview.error && preview.amountInCentimes === null && (
            <p className='mt-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900'>
              Saisissez un montant valide pour afficher la répartition automatique.
            </p>
          )}

          {actionState?.stale && (
            <div className='mt-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-950' role='alert'>
              <p className='font-semibold'>Aucun versement n’a été enregistré.</p>
              <p className='mt-1 leading-6'>
                {actionState.errors.form} Le récapitulatif ci-dessous a été actualisé. Vérifiez-le puis confirmez-le explicitement à nouveau.
              </p>
            </div>
          )}

          {actionState?.errors?.form && !actionState.stale && !uncertain && (
            <p className='mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800' role='alert'>
              {actionState.errors.form}
            </p>
          )}

          {uncertain && (
            <aside className='mt-5 rounded-xl border border-blue-300 bg-blue-50 px-4 py-4 text-sm text-blue-950' role='alert'>
              <h3 className='font-semibold'>Résultat du versement à vérifier</h3>
              <p className='mt-1 leading-6'>
                {actionState.errors.form} Le montant, la répartition et la clé de cette demande sont verrouillés jusqu’à sa résolution.
              </p>
              <button
                className='mt-3 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50'
                disabled={pending}
                onClick={() => runPaymentRequest(frozenRequest)}
                type='button'
              >
                {pending ? 'Vérification…' : 'Vérifier / Réessayer'}
              </button>
            </aside>
          )}

          {preview.allocations.length > 0 && (
            <section aria-labelledby='deliverer-payment-allocation-title' className='mt-6 rounded-xl border border-slate-200'>
              <div className='border-b border-slate-200 p-4'>
                <h3 className='font-semibold text-slate-950' id='deliverer-payment-allocation-title'>
                  Répartition automatique complète ({preview.allocations.length} tournée{preview.allocations.length > 1 ? 's' : ''})
                </h3>
                <p className='mt-1 text-xs leading-5 text-slate-500'>
                  La recherche et la pagination modifient uniquement l’affichage ; la confirmation porte toujours sur toutes les affectations.
                </p>
                <div className='mt-3'>
                  <label className='sr-only' htmlFor='deliverer-payment-allocation-search'>
                    Rechercher une tournée dans la répartition
                  </label>
                  <input
                    className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 sm:max-w-sm'
                    id='deliverer-payment-allocation-search'
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
                    placeholder='Rechercher une référence de tournée'
                    type='search'
                    value={query}
                  />
                </div>
              </div>

              <div className='hidden grid-cols-[minmax(0,1fr)_10rem_repeat(3,minmax(8rem,1fr))] gap-4 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid'>
                <span>Tournée</span>
                <span>Date du comptage</span>
                <span>Reste avant</span>
                <span>Montant affecté</span>
                <span>Reste après</span>
              </div>

              {paginatedAllocations.length > 0 ? paginatedAllocations.map((allocation) => (
                <article
                  className='grid gap-3 border-t border-slate-200 px-4 py-4 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_10rem_repeat(3,minmax(8rem,1fr))] sm:gap-4'
                  key={allocation.tourId}
                >
                  {[
                    ['Tournée', allocation.tourReference],
                    ['Date du comptage', formatCountingDate(allocation.countedAt)],
                    ['Reste avant', formatReceptionMoney(allocation.remainingBeforePaymentInCentimes)],
                    ['Montant affecté', formatReceptionMoney(allocation.allocatedAmountInCentimes)],
                    ['Reste après', formatReceptionMoney(allocation.remainingAfterPaymentInCentimes)],
                  ].map(([label, value]) => (
                    <p className='break-words text-xs text-slate-800' key={label}>
                      <span className='mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:hidden'>
                        {label}
                      </span>
                      {value}
                    </p>
                  ))}
                </article>
              )) : (
                <p className='border-t border-slate-200 px-4 py-8 text-center text-sm text-slate-600'>
                  Aucune tournée ne correspond à cette recherche.
                </p>
              )}

              <nav
                aria-label='Pagination de la répartition automatique'
                className='flex items-center justify-between gap-4 border-t border-slate-200 px-4 py-3'
              >
                <button
                  className='rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50'
                  disabled={activePage === 1}
                  onClick={() => setPage((current) => current - 1)}
                  type='button'
                >
                  Précédent
                </button>
                <p className='text-sm text-slate-600'>
                  Page {activePage} sur {totalPages}
                </p>
                <button
                  className='rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50'
                  disabled={activePage === totalPages}
                  onClick={() => setPage((current) => current + 1)}
                  type='button'
                >
                  Suivant
                </button>
              </nav>
            </section>
          )}

          {preview.amountInCentimes !== null && (
            <dl className='mt-5 grid gap-px overflow-hidden rounded-xl bg-amber-200 sm:grid-cols-3'>
              <div className='bg-amber-50 px-4 py-4'>
                <dt className='text-xs font-semibold uppercase tracking-wide text-amber-800'>
                  Montant reçu
                </dt>
                <dd className='mt-1 text-xl font-bold text-amber-950'>
                  {formatReceptionMoney(preview.amountInCentimes)}
                </dd>
              </div>
              <div className='bg-amber-50 px-4 py-4'>
                <dt className='text-xs font-semibold uppercase tracking-wide text-amber-800'>
                  Montant total réparti
                </dt>
                <dd className='mt-1 text-xl font-bold text-amber-950'>
                  {formatReceptionMoney(preview.totalAllocatedInCentimes)}
                </dd>
              </div>
              <div className='bg-amber-50 px-4 py-4'>
                <dt className='text-xs font-semibold uppercase tracking-wide text-amber-800'>
                  Reste total prévu
                </dt>
                <dd className='mt-1 text-xl font-bold text-amber-950'>
                  {formatReceptionMoney(
                    preview.totalRemainingAfterPaymentInCentimes,
                  )}
                </dd>
              </div>
            </dl>
          )}

          <input name='confirmationKey' type='hidden' value={confirmationKey} />
          <input name='delivererId' type='hidden' value={remainder.deliverer.id} />
          <input
            name='expectedCashRegisterId'
            type='hidden'
            value={cashRegister?.id ?? ''}
          />
          <input
            name='expectedSummary'
            type='hidden'
            value={JSON.stringify(preview)}
          />

          <div className='mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <p className='text-sm font-medium text-amber-900' role={pending ? 'status' : undefined}>
              {pending
                ? 'Enregistrement du versement et actualisation des soldes…'
                : 'La confirmation enregistrera une seule ligne de journal et toutes les affectations affichées.'}
            </p>
            {!uncertain && (
              <button
                className='rounded-lg bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50'
                disabled={!previewIsComplete || pending}
                type='submit'
              >
                {pending ? 'Enregistrement…' : 'Confirmer le versement'}
              </button>
            )}
          </div>

          <ConfirmationDialog
            confirmLabel='Confirmer toutes les affectations'
            dialogRef={dialogRef}
            onClose={restoreTriggerFocus}
            onConfirm={confirmSubmission}
            pending={pending}
            pendingLabel='Enregistrement…'
            title='Confirmer l’encaissement du livreur ?'
            tone='amber'
          >
            <p>
              Cette confirmation porte sur la remise d’argent et les {preview.allocations.length} affectation{preview.allocations.length > 1 ? 's' : ''} du récapitulatif complet.
            </p>
            <dl className='grid gap-2 rounded-xl bg-slate-50 p-4 sm:grid-cols-2'>
              {[
                ['Livreur', `${remainder.deliverer.code} — ${remainder.deliverer.name || 'Nom non renseigné'}`],
                ['Caisse', cashRegister ? `${cashRegister.name} (${cashRegister.code}, DZD)` : 'Indisponible'],
                ['Montant reçu', preview.amountInCentimes === null ? 'Non calculable' : formatReceptionMoney(preview.amountInCentimes)],
                ['Reste total prévu', preview.totalRemainingAfterPaymentInCentimes === null ? 'Non calculable' : formatReceptionMoney(preview.totalRemainingAfterPaymentInCentimes)],
                ['Note', note || 'Aucune note'],
                ['Répartition', `${preview.allocations.length} tournée${preview.allocations.length > 1 ? 's' : ''}, sans tenir compte de la page affichée`],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
                    {label}
                  </dt>
                  <dd className='mt-0.5 break-words font-semibold text-slate-950'>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </ConfirmationDialog>
        </form>
      </div>
    </div>
  );
};

export default DelivererCashAllocationPreview;
