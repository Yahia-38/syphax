'use client';

import { useMemo, useState } from 'react';

import { calculateCashPaymentPreview } from '../../../../lib/cash-payment-calculations.js';
import { formatReceptionMoney } from '../../../../lib/receptions.js';

const TourPaymentPreview = ({ canCreatePayment, preview }) => {
  const [opened, setOpened] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const calculation = useMemo(() => calculateCashPaymentPreview({
    amount,
    remainingDueInCentimes: preview.remainingDueInCentimes,
  }), [amount, preview.remainingDueInCentimes]);
  const nothingToCollect = preview.remainingDueInCentimes === 0;

  return (
    <section
      aria-labelledby='tour-payment-title'
      className='mt-8 overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 shadow-sm'
    >
      <div className='flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6'>
        <div>
          <p className='text-xs font-semibold uppercase tracking-wide text-amber-700'>
            Encaissement de cette tournée
          </p>
          <h2 className='mt-1 text-lg font-semibold text-slate-900' id='tour-payment-title'>
            Montant dû : {formatReceptionMoney(preview.amountDueInCentimes)}
          </h2>
          <p className='mt-2 text-sm font-medium text-slate-700'>
            Aucun versement enregistré
          </p>
          <p className='mt-1 max-w-3xl text-sm leading-6 text-slate-600'>
            Ces chiffres concernent uniquement cette tournée. Ils ne représentent
            pas le solde global du livreur.
          </p>
        </div>

        {!nothingToCollect && canCreatePayment && (
          <button
            aria-expanded={opened}
            className='inline-flex w-full items-center justify-center rounded-lg bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-800 sm:w-auto'
            onClick={() => setOpened((currentValue) => !currentValue)}
            type='button'
          >
            {opened ? 'Masquer le formulaire' : 'Encaisser'}
          </button>
        )}
      </div>

      {nothingToCollect ? (
        <div className='border-t border-amber-200 bg-white/70 px-5 py-5 sm:px-6'>
          <p className='font-semibold text-emerald-800'>
            Aucun montant à encaisser
          </p>
        </div>
      ) : opened && canCreatePayment ? (
        <form
          className='border-t border-amber-200 bg-white/70 p-5 sm:p-6'
          onSubmit={(event) => event.preventDefault()}
        >
          <div className='grid gap-5 lg:grid-cols-2'>
            <div>
              <label className='text-sm font-semibold text-slate-800' htmlFor='tour-payment-amount'>
                Montant reçu en DA
              </label>
              <input
                aria-describedby={calculation.error ? 'tour-payment-amount-error' : undefined}
                aria-invalid={Boolean(calculation.error)}
                className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-100'
                id='tour-payment-amount'
                inputMode='decimal'
                name='amount'
                onChange={(event) => setAmount(event.target.value)}
                placeholder='Ex. 5000'
                type='text'
                value={amount}
              />
              {calculation.error && (
                <p className='mt-2 text-sm font-medium text-red-700' id='tour-payment-amount-error' role='alert'>
                  {calculation.error}
                </p>
              )}
            </div>

            <div>
              <label className='text-sm font-semibold text-slate-800' htmlFor='tour-payment-note'>
                Note facultative
              </label>
              <textarea
                className='mt-2 min-h-24 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-100'
                id='tour-payment-note'
                maxLength={500}
                name='note'
                onChange={(event) => setNote(event.target.value)}
                placeholder='Précision sur le versement'
                value={note}
              />
            </div>
          </div>

          <div className='mt-5 rounded-xl border border-amber-200 bg-amber-100 px-4 py-4'>
            <p className='text-xs font-semibold uppercase tracking-wide text-amber-800'>
              Reste prévu pour cette tournée après ce versement
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

          <div className='mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <p className='max-w-2xl text-sm leading-6 text-slate-600'>
              Prévisualisation uniquement : cette saisie n’est pas sauvegardée
              et aucun versement ni mouvement de caisse ne sera enregistré.
            </p>
            <button
              className='inline-flex w-full cursor-not-allowed items-center justify-center rounded-lg bg-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600 sm:w-auto'
              disabled
              type='submit'
            >
              Confirmation indisponible
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
};

export default TourPaymentPreview;
