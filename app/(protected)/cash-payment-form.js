'use client';

import { TourFormActions, useTourDraft } from './tournees/[id]/tour-operation-context.js';

import { useMemo, useState } from 'react';

import { calculateCashPaymentPreview } from '../../lib/cash-payment-calculations.js';
import { formatReceptionMoney } from '../../lib/receptions.js';
import ConfirmationDialog, {
  useFormConfirmation,
} from './confirmation-dialog.js';

const CashPaymentForm = ({
  cashRegister,
  confirmationKey,
  deliverer,
  formAction,
  idPrefix,
  pending,
  remainingDueInCentimes,
  state,
  tourId,
  tourReference,
}) => {
  const [amount, setAmount] = useState(state.values?.amount ?? '');
  const [note, setNote] = useState(state.values?.note ?? '');
  const {
    confirmSubmission,
    dialogRef,
    requestConfirmation,
    restoreTriggerFocus,
  } = useFormConfirmation();
  useTourDraft({ amount, note });
  const calculation = useMemo(() => calculateCashPaymentPreview({
    amount,
    remainingDueInCentimes,
  }), [amount, remainingDueInCentimes]);
  const serverAmountError = state.values?.amount === amount
    ? state.errors.amount
    : null;
  const serverNoteError = state.values?.note === note
    ? state.errors.note
    : null;
  const amountError = calculation.error ?? serverAmountError;
  const amountId = `${idPrefix}-amount`;
  const amountErrorId = `${amountId}-error`;
  const noteId = `${idPrefix}-note`;
  const noteErrorId = `${noteId}-error`;
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (
          !event.nativeEvent.submitter
          || calculation.remainingAfterPaymentInCentimes === null
        ) {
          event.preventDefault();
          return;
        }

        requestConfirmation(event);
      }}
    >
      <div className='rounded-xl border border-amber-200 bg-amber-100 px-4 py-3 text-sm text-amber-950'>
        Caisse destinataire : <strong>{cashRegister.name}</strong>
        {' '}({cashRegister.code}, DZD)
      </div>

      <div className='mt-5 grid gap-5 lg:grid-cols-2'>
        <div>
          <label className='text-sm font-semibold text-slate-800' htmlFor={amountId}>
            Montant réellement reçu en DA
          </label>
          <input
            aria-describedby={amountError ? amountErrorId : undefined}
            aria-invalid={Boolean(amountError)}
            autoFocus
            className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-100'
            disabled={pending}
            id={amountId}
            inputMode='decimal'
            name='amount'
            onChange={(event) => setAmount(event.target.value)}
            placeholder='Ex. 5000'
            type='text'
            value={amount}
          />
          {amountError && (
            <p className='mt-2 text-sm font-medium text-red-700' id={amountErrorId} role='alert' tabIndex={-1}>
              {amountError}
            </p>
          )}
        </div>

        <div>
          <label className='text-sm font-semibold text-slate-800' htmlFor={noteId}>
            Note facultative
          </label>
          <textarea
            aria-describedby={serverNoteError ? noteErrorId : undefined}
            aria-invalid={Boolean(serverNoteError)}
            className='mt-2 min-h-24 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-100'
            disabled={pending}
            id={noteId}
            maxLength={500}
            name='note'
            onChange={(event) => setNote(event.target.value)}
            placeholder='Précision sur le versement'
            value={note}
          />
          {serverNoteError && (
            <p className='mt-2 text-sm font-medium text-red-700' id={noteErrorId} role='alert' tabIndex={-1}>
              {serverNoteError}
            </p>
          )}
        </div>
      </div>

      <p className='mt-4 text-sm text-slate-600'>Reste avant : {formatReceptionMoney(remainingDueInCentimes)} · Montant saisi : {Number.isSafeInteger(calculation.amountInCentimes) ? formatReceptionMoney(calculation.amountInCentimes) : 'À renseigner'}</p>
      <div className='mt-5 rounded-xl border border-amber-200 bg-amber-100 px-4 py-4'>
        <p className='text-xs font-semibold uppercase tracking-wide text-amber-800'>
          Prévisualisation · reste après versement
        </p>
        {calculation.remainingAfterPaymentInCentimes === null ? (
          <p className='mt-1 text-sm font-medium text-slate-600'>
            Saisissez un montant valide pour calculer le reste prévu.
          </p>
        ) : (
          <p className='mt-1 text-2xl font-bold tabular-nums text-amber-950'>
            {formatReceptionMoney(
              calculation.remainingAfterPaymentInCentimes,
            )}
          </p>
        )}
      </div>

      {state.errors.form && (
        <p className='mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800' role='alert' tabIndex={-1}>
          {state.errors.form}
        </p>
      )}

      <input name='confirmationKey' type='hidden' value={confirmationKey} />
      <input
        name='expectedCashRegisterId'
        type='hidden'
        value={cashRegister.id}
      />
      <input
        name='expectedRemainingDueInCentimes'
        type='hidden'
        value={remainingDueInCentimes}
      />
      <input name='tourId' type='hidden' value={tourId} />

      <div className='mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <p className='max-w-2xl text-sm leading-6 text-slate-600'>
          La confirmation enregistre l’argent effectivement reçu. Le versement
          sera conservé sans modification ni suppression.
        </p>
        <TourFormActions pending={pending}><button
          className='inline-flex w-full items-center justify-center rounded-lg bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto'
          disabled={pending
            || calculation.remainingAfterPaymentInCentimes === null}
          type='submit'
        >
          {pending ? 'Enregistrement…' : 'Enregistrer le versement'}
        </button></TourFormActions>
      </div>

      <ConfirmationDialog
        confirmLabel='Enregistrer le versement'
        dialogRef={dialogRef}
        onClose={restoreTriggerFocus}
        onConfirm={confirmSubmission}
        pending={pending}
        pendingLabel='Enregistrement…'
        title='Confirmer l’encaissement ?'
        tone='amber'
      >
        <p>
          Confirmez l’argent effectivement reçu pour cette tournée.
        </p>
        <dl className='grid gap-2 rounded-xl bg-slate-50 p-4 sm:grid-cols-2'>
          {[
            ['Livreur', `${deliverer.code} — ${deliverer.name}`],
            ['Tournée', tourReference],
            ['Caisse', `${cashRegister.name} (${cashRegister.code})`],
            [
              'Montant reçu',
              calculation.amountInCentimes === null
                ? 'Non calculable'
                : formatReceptionMoney(calculation.amountInCentimes),
            ],
            [
              'Reste prévu',
              calculation.remainingAfterPaymentInCentimes === null
                ? 'Non calculable'
                : formatReceptionMoney(
                    calculation.remainingAfterPaymentInCentimes,
                  ),
            ],
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
  );
};

export default CashPaymentForm;
