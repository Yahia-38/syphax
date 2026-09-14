'use client';

import { useActionState } from 'react';

import ConfirmationDialog, {
  useFormConfirmation,
} from '../../confirmation-dialog.js';
import { formatReceptionMoney } from '../../../../lib/receptions.js';
import { closeTour } from './actions.js';

const INITIAL_STATE = {
  errors: {},
  message: null,
  replayed: false,
  revision: 0,
  stale: false,
  succeeded: false,
};

const TourClosingConfirmation = ({ preview, tourId }) => {
  const closeCurrentTour = closeTour.bind(null, tourId);
  const [state, formAction, pending] = useActionState(
    closeCurrentTour,
    INITIAL_STATE,
  );
  const {
    confirmSubmission,
    dialogRef,
    requestConfirmation,
    restoreTriggerFocus,
  } = useFormConfirmation();

  if (preview.errors?.form) {
    return (
      <section className='mt-8 rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm sm:p-6'>
        <p className='font-semibold text-red-800' role='alert'>
          {preview.errors.form}
        </p>
      </section>
    );
  }

  const remainingMessage = preview.remainingDueInCentimes > 0
    ? `Cette tournée sera terminée avec un reste à payer de ${formatReceptionMoney(preview.remainingDueInCentimes)}. Ce montant pourra être encaissé ultérieurement.`
    : 'Cette tournée est soldée. Aucun versement supplémentaire n’est nécessaire.';
  return (
    <section
      aria-labelledby='tour-closing-title'
      className='mt-8 overflow-hidden rounded-2xl border border-slate-300 bg-slate-50 shadow-sm'
    >
      <div className='p-5 sm:p-6'>
        <p className='text-xs font-semibold uppercase tracking-wide text-slate-600'>
          État opérationnel
        </p>
        <h2 className='mt-1 text-lg font-semibold text-slate-900' id='tour-closing-title'>
          Terminer la tournée
        </h2>
        <p className='mt-2 max-w-3xl text-sm leading-6 text-slate-600'>
          La clôture conserve le comptage et les versements. Elle ne crée aucun
          encaissement et n’empêche pas de régler ultérieurement un reste dû.
        </p>
      </div>

      <dl className='grid gap-px border-t border-slate-300 bg-slate-300 sm:grid-cols-2 lg:grid-cols-5'>
        {[
          ['Ventes brutes', preview.grossSalesInCentimes],
          ['Frais déclarés', preview.totalExpensesInCentimes],
          ['Net à remettre', preview.netDueInCentimes],
          ['Total encaissé', preview.amountPaidInCentimes],
          ['Reste à payer', preview.remainingDueInCentimes],
        ].map(([label, value]) => (
          <div className='bg-white px-5 py-4 sm:px-6' key={label}>
            <dt className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
              {label}
            </dt>
            <dd className='mt-1 text-xl font-bold tabular-nums text-slate-950'>
              {formatReceptionMoney(value)}
            </dd>
          </div>
        ))}
      </dl>

      <form
        action={formAction}
        className='border-t border-slate-200 bg-white p-5 sm:p-6'
        onSubmit={requestConfirmation}
      >
        <p className={`rounded-xl border px-4 py-3 text-sm leading-6 ${preview.remainingDueInCentimes > 0 ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
          {remainingMessage}
        </p>

        {state.errors.form && (
          <p className='mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800' role='alert'>
            {state.errors.form}
          </p>
        )}

        <input name='closureDigest' type='hidden' value={preview.digest} />

        <div className='mt-5 flex justify-end'>
          <button
            className='inline-flex w-full items-center justify-center rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto'
            disabled={pending}
            type='submit'
          >
            {pending ? 'Clôture…' : 'Terminer la tournée'}
          </button>
        </div>

        <ConfirmationDialog
          confirmLabel='Terminer la tournée'
          dialogRef={dialogRef}
          onClose={restoreTriggerFocus}
          onConfirm={confirmSubmission}
          pending={pending}
          pendingLabel='Clôture…'
          title='Terminer cette tournée ?'
          tone='slate'
        >
          <p>
            Tournée <strong className='text-slate-950'>{preview.tourReference}</strong>
            {' '}de {preview.deliverer.code} — {preview.deliverer.name}.
          </p>
          <dl className='grid gap-2 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-5'>
            {[
              ['Ventes brutes', preview.grossSalesInCentimes],
              ['Frais déclarés', preview.totalExpensesInCentimes],
              ['Net à remettre', preview.netDueInCentimes],
              ['Total encaissé', preview.amountPaidInCentimes],
              ['Reste à payer', preview.remainingDueInCentimes],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
                  {label}
                </dt>
                <dd className='mt-0.5 font-semibold text-slate-950'>
                  {formatReceptionMoney(value)}
                </dd>
              </div>
            ))}
          </dl>
          <p>{remainingMessage}</p>
        </ConfirmationDialog>
      </form>
    </section>
  );
};

export default TourClosingConfirmation;
