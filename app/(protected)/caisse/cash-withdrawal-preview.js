'use client';

import { useRef, useState, useTransition } from 'react';

import {
  CASH_WITHDRAWAL_REASON_MAX_LENGTH,
  validateCashWithdrawalPreview,
} from '../../../lib/cash-withdrawal-calculations.js';
import { formatReceptionMoney } from '../../../lib/receptions.js';
import { recordWithdrawal } from '../cash-withdrawal-actions.js';
import ConfirmationDialog from '../confirmation-dialog.js';

const REQUEST_FIELD_NAMES = Object.freeze([
  'amount',
  'confirmationKey',
  'expectedBalanceInCentimes',
  'expectedCashRegisterId',
  'reason',
]);

const freezeWithdrawalRequest = (formData) => Object.fromEntries(
  REQUEST_FIELD_NAMES.map((name) => {
    const value = formData.get(name);
    return [name, typeof value === 'string' ? value : ''];
  }),
);

const createWithdrawalFormData = (request) => {
  const formData = new FormData();

  for (const name of REQUEST_FIELD_NAMES) {
    formData.set(name, request[name]);
  }

  return formData;
};

const CashWithdrawalPreview = ({
  balanceInCentimes,
  cashRegister,
  error,
  initialConfirmationKey,
}) => {
  const triggerRef = useRef(null);
  const submissionInFlightRef = useRef(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState({ amount: false, reason: false });
  const [actionState, setActionState] = useState(null);
  const [confirmationKey, setConfirmationKey] = useState(
    initialConfirmationKey,
  );
  const [frozenRequest, setFrozenRequest] = useState(null);
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [transitionPending, startTransition] = useTransition();
  const dialogRef = useRef(null);
  const summary = actionState?.stale && actionState.summary
    ? actionState.summary
    : { balanceInCentimes, cashRegister, error };
  const validation = validateCashWithdrawalPreview({
    amount,
    balanceInCentimes: summary.balanceInCentimes,
    reason,
  });
  const pending = submitting || transitionPending;
  const uncertain = Boolean(actionState?.uncertain && frozenRequest);
  const fieldsDisabled = pending
    || uncertain
    || !summary.cashRegister
    || summary.balanceInCentimes === null
    || Boolean(summary.error);
  const requestIsValid = !fieldsDisabled
    && Object.keys(validation.errors).length === 0
    && validation.amountInCentimes !== null
    && validation.balanceAfterWithdrawalInCentimes !== null;

  const clearResolvedState = () => {
    if (!uncertain) {
      setActionState(null);
      setFrozenRequest(null);
      setNotice(null);
    }
  };

  const openPreview = () => {
    if (uncertain) {
      return;
    }

    setAmount('');
    setReason('');
    setTouched({ amount: false, reason: false });
    setActionState(null);
    setFrozenRequest(null);
    dialogRef.current?.showModal();
  };

  const runWithdrawalRequest = (request) => {
    if (submissionInFlightRef.current) {
      return;
    }

    submissionInFlightRef.current = true;
    setFrozenRequest(request);
    setSubmitting(true);

    startTransition(async () => {
      try {
        const result = await recordWithdrawal(
          createWithdrawalFormData(request),
        );

        if (result.succeeded) {
          setNotice({
            message: result.message,
            reference: result.withdrawal.reference,
          });
          setConfirmationKey(result.nextConfirmationKey);
          setAmount('');
          setReason('');
          setTouched({ amount: false, reason: false });
          setActionState(null);
          setFrozenRequest(null);
          dialogRef.current?.close();
          return;
        }

        setActionState(result);

        if (!result.uncertain) {
          setFrozenRequest(null);
        }

        if (result.stale && result.nextConfirmationKey) {
          setConfirmationKey(result.nextConfirmationKey);
        }
      } catch (requestError) {
        console.error('Réponse introuvable du retrait d’espèces :', requestError);
        setActionState({
          errors: {
            form: 'La réponse n’a pas été reçue. Le retrait peut avoir été enregistré.',
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

  const submitWithdrawal = (formData) => {
    if (!requestIsValid || uncertain) {
      return;
    }

    runWithdrawalRequest(freezeWithdrawalRequest(formData));
  };

  return (
    <div className='flex flex-col items-start gap-2 sm:items-end'>
      <button
        className='inline-flex items-center justify-center rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-60'
        disabled={uncertain}
        onClick={openPreview}
        ref={triggerRef}
        type='button'
      >
        Retirer des espèces
      </button>

      {notice && (
        <p className='max-w-md text-sm font-semibold text-emerald-800' role='status'>
          {notice.message} Référence : {notice.reference}.
        </p>
      )}

      <form
        action={submitWithdrawal}
        onSubmit={(event) => {
          setTouched({ amount: true, reason: true });

          if (!requestIsValid || pending || uncertain) {
            event.preventDefault();
            return;
          }

        }}
      >
        <ConfirmationDialog
          confirmDisabled={!requestIsValid || uncertain}
          confirmLabel='Confirmer le retrait'
          dialogRef={dialogRef}
          onClose={() => {
            triggerRef.current?.focus();
          }}
          onConfirm={() => {}}
          pending={pending || uncertain}
          pendingLabel='Enregistrement…'
          title='Confirmer le retrait d’espèces ?'
          tone='red'
        >
          <p>
            Le retrait sera enregistré définitivement dans le journal de la
            caisse. Il ne crée ni charge de rentabilité ni mouvement de stock.
          </p>

          {summary.error ? (
            <p className='rounded-xl border border-red-200 bg-red-50 p-4 font-semibold text-red-900' role='alert'>
              {summary.error}
            </p>
          ) : summary.cashRegister ? (
            <dl className='grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2'>
              <div>
                <dt className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
                  Caisse
                </dt>
                <dd className='mt-1 font-semibold text-slate-950'>
                  {summary.cashRegister.name} — {summary.cashRegister.code}
                </dd>
              </div>
              <div>
                <dt className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
                  Solde suivi avant retrait
                </dt>
                <dd className='mt-1 font-semibold text-slate-950'>
                  {formatReceptionMoney(summary.balanceInCentimes)}
                </dd>
              </div>
            </dl>
          ) : null}

          <div>
            <label className='font-semibold text-slate-800' htmlFor='cash-withdrawal-amount'>
              Montant retiré en DA
            </label>
            <input
              aria-describedby={touched.amount && validation.errors.amount
                ? 'cash-withdrawal-amount-error'
                : undefined}
              aria-invalid={touched.amount && Boolean(validation.errors.amount)}
              className='mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-red-600 focus:ring-2 focus:ring-red-100 disabled:cursor-not-allowed disabled:bg-slate-100'
              disabled={fieldsDisabled}
              id='cash-withdrawal-amount'
              inputMode='decimal'
              name='amount'
              onBlur={() => setTouched((current) => ({ ...current, amount: true }))}
              onChange={(event) => {
                setAmount(event.target.value);
                clearResolvedState();
              }}
              placeholder='0,00'
              type='text'
              value={amount}
            />
            {touched.amount && validation.errors.amount && (
              <p className='mt-1.5 text-sm font-medium text-red-700' id='cash-withdrawal-amount-error' role='alert'>
                {validation.errors.amount}
              </p>
            )}
          </div>

          <div>
            <label className='font-semibold text-slate-800' htmlFor='cash-withdrawal-reason'>
              Motif
            </label>
            <textarea
              aria-describedby={touched.reason && validation.errors.reason
                ? 'cash-withdrawal-reason-error'
                : 'cash-withdrawal-reason-help'}
              aria-invalid={touched.reason && Boolean(validation.errors.reason)}
              className='mt-1.5 min-h-24 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-red-600 focus:ring-2 focus:ring-red-100 disabled:cursor-not-allowed disabled:bg-slate-100'
              disabled={fieldsDisabled}
              id='cash-withdrawal-reason'
              maxLength={CASH_WITHDRAWAL_REASON_MAX_LENGTH}
              name='reason'
              onBlur={() => setTouched((current) => ({ ...current, reason: true }))}
              onChange={(event) => {
                setReason(event.target.value);
                clearResolvedState();
              }}
              placeholder='Indiquez pourquoi les espèces sont retirées'
              value={reason}
            />
            {touched.reason && validation.errors.reason ? (
              <p className='mt-1.5 text-sm font-medium text-red-700' id='cash-withdrawal-reason-error' role='alert'>
                {validation.errors.reason}
              </p>
            ) : (
              <p className='mt-1.5 text-xs text-slate-500' id='cash-withdrawal-reason-help'>
                Obligatoire, {CASH_WITHDRAWAL_REASON_MAX_LENGTH} caractères maximum.
              </p>
            )}
          </div>

          {validation.amountInCentimes !== null
            && validation.balanceAfterWithdrawalInCentimes !== null && (
            <dl className='grid gap-2 rounded-xl border border-red-200 bg-red-50 p-4 sm:grid-cols-2'>
              <div>
                <dt className='text-xs font-semibold uppercase tracking-wide text-red-700'>
                  Montant retiré
                </dt>
                <dd className='mt-1 font-bold text-red-950'>
                  {formatReceptionMoney(validation.amountInCentimes)}
                </dd>
              </div>
              <div>
                <dt className='text-xs font-semibold uppercase tracking-wide text-red-700'>
                  Solde prévu après retrait
                </dt>
                <dd className='mt-1 font-bold text-red-950'>
                  {formatReceptionMoney(
                    validation.balanceAfterWithdrawalInCentimes,
                  )}
                </dd>
              </div>
            </dl>
          )}

          {actionState?.stale && (
            <div className='rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950' role='alert'>
              <p className='font-semibold'>Aucun retrait n’a été enregistré.</p>
              <p className='mt-1'>
                {actionState.errors.form} Vérifiez le nouveau récapitulatif puis
                confirmez-le explicitement.
              </p>
            </div>
          )}

          {actionState?.errors?.form && !actionState.stale && !uncertain && (
            <p className='rounded-xl border border-red-200 bg-red-50 p-4 font-semibold text-red-900' role='alert'>
              {actionState.errors.form}
            </p>
          )}

          {actionState?.errors?.amount && !actionState.stale && (
            <p className='rounded-xl border border-red-200 bg-red-50 p-4 font-semibold text-red-900' role='alert'>
              {actionState.errors.amount}
            </p>
          )}

          {uncertain && (
            <aside className='rounded-xl border border-blue-300 bg-blue-50 p-4 text-blue-950' role='alert'>
              <h3 className='font-semibold'>Résultat du retrait à vérifier</h3>
              <p className='mt-1'>
                {actionState.errors.form} Le montant, le motif et la clé restent
                verrouillés jusqu’à la résolution.
              </p>
              <button
                className='mt-3 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50'
                disabled={pending}
                onClick={() => runWithdrawalRequest(frozenRequest)}
                type='button'
              >
                {pending ? 'Vérification…' : 'Vérifier / Réessayer'}
              </button>
            </aside>
          )}

          <p className='text-xs leading-5 text-slate-500'>
            Le solde suivi est calculé depuis l’historique enregistré. Il ne
            constitue pas un comptage physique du tiroir.
          </p>

          <input
            name='confirmationKey'
            type='hidden'
            value={confirmationKey}
          />
          <input
            name='expectedBalanceInCentimes'
            type='hidden'
            value={summary.balanceInCentimes ?? ''}
          />
          <input
            name='expectedCashRegisterId'
            type='hidden'
            value={summary.cashRegister?.id ?? ''}
          />
        </ConfirmationDialog>
      </form>
    </div>
  );
};

export default CashWithdrawalPreview;
