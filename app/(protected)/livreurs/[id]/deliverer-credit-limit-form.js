'use client';

import { useActionState, useState } from 'react';

import {
  formatReceptionMoney,
  parseReceptionAmountInCentimes,
} from '../../../../lib/receptions.js';
import ConfirmationDialog, {
  useFormConfirmation,
} from '../../confirmation-dialog.js';
import { updateDelivererCreditLimit } from './actions.js';

const INITIAL_STATE = {
  errors: {},
  message: null,
  revision: 0,
  stale: false,
  succeeded: false,
  values: { amount: '' },
};

const MAX_CREDIT_LIMIT_IN_DINARS = '90071992547409.91';

const formatAmountInput = (amountInCentimes) => {
  if (!Number.isSafeInteger(amountInCentimes) || amountInCentimes < 0) {
    return '';
  }

  const dinars = Math.floor(amountInCentimes / 100);
  const centimes = amountInCentimes % 100;

  return centimes === 0
    ? String(dinars)
    : `${dinars}.${String(centimes).padStart(2, '0')}`;
};

const formatCreditLimit = (amountInCentimes) =>
  Number.isSafeInteger(amountInCentimes)
    ? formatReceptionMoney(amountInCentimes)
    : 'Non configurée';

const formatDate = (value) => value
  ? new Intl.DateTimeFormat('fr-DZ', {
      dateStyle: 'long',
      hourCycle: 'h23',
      timeStyle: 'short',
      timeZone: 'Africa/Algiers',
    }).format(new Date(value))
  : 'Date indisponible';

const DelivererCreditLimitForm = ({
  canUpdate,
  creditLimit,
  delivererId,
}) => {
  const currentAmount = formatAmountInput(creditLimit.amountInCentimes);
  const [amount, setAmount] = useState(currentAmount);
  const [isEditing, setIsEditing] = useState(false);
  const {
    confirmSubmission,
    dialogRef,
    requestConfirmation,
    restoreTriggerFocus,
  } = useFormConfirmation();
  const updateCreditLimit = updateDelivererCreditLimit.bind(
    null,
    delivererId,
  );
  const runUpdate = async (previousState, formData) => {
    const nextState = await updateCreditLimit(previousState, formData);

    setAmount(nextState.values.amount);
    setIsEditing(!nextState.succeeded);

    return nextState;
  };
  const [state, formAction, pending] = useActionState(
    runUpdate,
    INITIAL_STATE,
  );
  const proposedAmountInCentimes = parseReceptionAmountInCentimes(amount);

  return (
    <section
      aria-labelledby='deliverer-credit-limit-title'
      className='mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'
    >
      <div className='flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6'>
        <div>
          <p className='text-xs font-semibold uppercase tracking-wide text-blue-700'>
            Paramètre financier
          </p>
          <h2
            className='mt-1 text-xl font-semibold text-slate-950'
            id='deliverer-credit-limit-title'
          >
            Limite de crédit
          </h2>
          <p className='mt-1 text-sm leading-6 text-slate-600'>
            Plafond d’engagement autorisé pour ce livreur.
          </p>
        </div>
        {canUpdate && !isEditing && (
          <button
            aria-label='Modifier la limite de crédit'
            className='inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-blue-700 transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            onClick={() => {
              setAmount(currentAmount);
              setIsEditing(true);
            }}
            title='Modifier la limite de crédit'
            type='button'
          >
            <svg
              aria-hidden='true'
              fill='none'
              height='18'
              stroke='currentColor'
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth='2'
              viewBox='0 0 24 24'
              width='18'
            >
              <path d='M12 20h9' />
              <path d='M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z' />
            </svg>
          </button>
        )}
      </div>

      <div className='p-5 sm:p-6'>
        {isEditing ? (
          <form action={formAction} onSubmit={requestConfirmation}>
            <input
              name='creditLimitExpectedVersion'
              type='hidden'
              value={creditLimit.version}
            />
            {state.errors.form && (
              <p
                className='mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'
                role='alert'
              >
                {state.errors.form}
              </p>
            )}
            <label
              className='text-sm font-semibold text-slate-800'
              htmlFor='deliverer-credit-limit'
            >
              Limite en dinars algériens
            </label>
            <div className='mt-2 flex max-w-md items-stretch rounded-lg shadow-sm'>
              <input
                aria-describedby={state.errors.amount
                  ? 'deliverer-credit-limit-error deliverer-credit-limit-help'
                  : 'deliverer-credit-limit-help'}
                aria-invalid={Boolean(state.errors.amount)}
                autoFocus
                className='min-w-0 flex-1 rounded-l-lg border border-r-0 border-slate-300 bg-white px-3 py-2.5 text-right text-lg font-semibold tabular-nums text-slate-950 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-600 aria-invalid:focus:ring-red-100'
                id='deliverer-credit-limit'
                inputMode='decimal'
                max={MAX_CREDIT_LIMIT_IN_DINARS}
                min='0'
                name='creditLimitAmount'
                onChange={(event) => setAmount(event.target.value)}
                placeholder='Ex. 150000,00'
                required
                step='0.01'
                type='number'
                value={amount}
              />
              <span className='inline-flex items-center rounded-r-lg border border-slate-300 bg-slate-100 px-3 text-sm font-semibold text-slate-700'>
                DA
              </span>
            </div>
            <p
              className='mt-2 text-xs leading-5 text-slate-500'
              id='deliverer-credit-limit-help'
            >
              Zéro signifie qu’aucun crédit n’est autorisé.
            </p>
            {state.errors.amount && (
              <p
                className='mt-1.5 text-sm text-red-700'
                id='deliverer-credit-limit-error'
              >
                {state.errors.amount}
              </p>
            )}

            <div className='mt-4 flex flex-wrap gap-3'>
              <button
                className='rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
                disabled={pending}
                type='submit'
              >
                {pending ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              <button
                className='rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
                disabled={pending}
                onClick={() => {
                  setAmount(currentAmount);
                  setIsEditing(false);
                }}
                type='button'
              >
                Annuler
              </button>
            </div>

            <ConfirmationDialog
              confirmLabel='Confirmer la limite'
              dialogRef={dialogRef}
              onClose={restoreTriggerFocus}
              onConfirm={confirmSubmission}
              pending={pending}
              pendingLabel='Enregistrement…'
              title='Confirmer la limite de crédit ?'
              tone='blue'
            >
              <p>
                La limite passera de <strong className='text-slate-950'>
                  {formatCreditLimit(creditLimit.amountInCentimes)}
                </strong> à <strong className='text-slate-950'>
                  {proposedAmountInCentimes === null
                    ? 'Montant invalide'
                    : formatCreditLimit(proposedAmountInCentimes)}
                </strong>.
              </p>
              <p>
                Une modification effective sera conservée dans l’historique.
              </p>
            </ConfirmationDialog>
          </form>
        ) : (
          <div className='rounded-xl border border-blue-100 bg-blue-50 p-5'>
            <p className='text-xs font-bold uppercase tracking-wide text-blue-700'>
              Plafond actuel
            </p>
            <p className={`mt-2 text-3xl font-bold tabular-nums ${creditLimit.configured ? 'text-blue-950' : 'text-slate-500'}`}>
              {formatCreditLimit(creditLimit.amountInCentimes)}
            </p>
            {creditLimit.configured && (
              <p className='mt-3 text-xs leading-5 text-blue-800'>
                Dernière modification le {formatDate(creditLimit.updatedAt)} ·{' '}
                {creditLimit.updatedBy ?? 'Compte indisponible'}
              </p>
            )}
          </div>
        )}
      </div>

      <p className='border-t border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-900 sm:px-6'>
        Le contrôle de cette limite au chargement n’est pas encore activé.
      </p>
      {state.message && !isEditing && (
        <p
          className='border-t border-emerald-200 bg-emerald-50 px-5 py-3.5 text-sm font-semibold text-emerald-800 sm:px-6'
          role='status'
        >
          {state.message}
        </p>
      )}
    </section>
  );
};

export default DelivererCreditLimitForm;
