'use client';

import { useRef, useState, useTransition } from 'react';

import {
  CASH_WITHDRAWAL_REASON_MAX_LENGTH,
  validateCashWithdrawalPreview,
} from '../../../lib/cash-withdrawal-calculations.js';
import { formatReceptionMoney as formatKnownMoney } from '../../../lib/receptions.js';
import { recordWithdrawal } from '../cash-withdrawal-actions.js';
import ConfirmationDialog, { useFormConfirmation } from '../confirmation-dialog.js';
import { useCashFormLifecycle, useCashNotice } from './cash-form-context.js';
import styles from './cash.module.css';

const formatReceptionMoney = (value) => Number.isSafeInteger(value) && value >= 0 ? formatKnownMoney(value) : 'Non calculable';

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
  onCancel, onSuccess, onPending, onDraftChange,
}) => {
  const showNotice = useCashNotice();
  const submissionInFlightRef = useRef(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState({ amount: false, reason: false });
  const [actionState, setActionState] = useState(null);
  const [confirmationKey, setConfirmationKey] = useState(
    initialConfirmationKey,
  );
  const [frozenRequest, setFrozenRequest] = useState(null);
  const [frozenSummary, setFrozenSummary] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [transitionPending, startTransition] = useTransition();
  const { dialogRef, requestConfirmation, confirmSubmission, restoreTriggerFocus } = useFormConfirmation();
  const pending = submitting || transitionPending;
  const uncertain = Boolean(actionState?.uncertain && frozenRequest);
  const summary = (pending || uncertain) && frozenSummary ? frozenSummary : actionState?.stale && actionState.summary
    ? actionState.summary
    : { balanceInCentimes, cashRegister, error };
  const validation = validateCashWithdrawalPreview({
    amount,
    balanceInCentimes: summary.balanceInCentimes,
    reason,
  });
  const fieldsDisabled = pending
    || uncertain
    || !summary.cashRegister
    || !Number.isSafeInteger(summary.balanceInCentimes)
    || Boolean(summary.error);
  const requestIsValid = !fieldsDisabled
    && Object.keys(validation.errors).length === 0
    && validation.amountInCentimes !== null
    && validation.balanceAfterWithdrawalInCentimes !== null;

  const formRef = useCashFormLifecycle({ onPending, onDraftChange, pending, uncertain, values: { amount, reason }, result: actionState });

  const clearResolvedState = () => {
    if (!uncertain) {
      setActionState(null);
      setFrozenRequest(null);
    }
  };

  const runWithdrawalRequest = (request) => {
    if (submissionInFlightRef.current) {
      return;
    }

    submissionInFlightRef.current = true;
    onPending(true);
    if (!uncertain) setFrozenSummary(summary);
    setFrozenRequest(request);
    setSubmitting(true);

    startTransition(async () => {
      try {
        const result = await recordWithdrawal(
          createWithdrawalFormData(request),
        );

        if (result.succeeded) {
          showNotice(`${result.message} Référence : ${result.withdrawal.reference}.`);
          onSuccess(result.message);
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
    <form ref={formRef} action={submitWithdrawal} className={styles.inlineForm}
      onSubmit={(event) => {
        setTouched({ amount: true, reason: true });
        if (!requestIsValid || pending || uncertain || submissionInFlightRef.current) {
          event.preventDefault();
          requestAnimationFrame(() => formRef.current?.querySelector('[aria-invalid="true"]')?.focus());
          return;
        }
        requestConfirmation(event);
      }}>
          <div className={styles.editorContext}>Caisse source : <strong>{summary.cashRegister ? `${summary.cashRegister.name} · ${summary.cashRegister.code} · DZD` : 'Indisponible'}</strong></div>
          <p className={styles.contextNotice}>Un retrait diminue le solde suivi. Il ne crée ni charge de rentabilité, ni mouvement de stock, ni réduction d’une dette livreur.</p>
          {summary.error && <p className={styles.error} role='alert' tabIndex={-1}>{summary.error}</p>}
          <div className={styles.formFields}>
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
              data-autofocus
              id='cash-withdrawal-amount'
              inputMode='decimal'
              name='amount'
              onBlur={() => setTouched((current) => ({ ...current, amount: true }))}
              onChange={(event) => {
                setAmount(event.target.value);
                clearResolvedState();
              }}
              placeholder='Ex. 5000'
              type='text'
              value={amount}
            />
            {touched.amount && validation.errors.amount && (
              <p className='mt-1.5 text-sm font-medium text-red-700' id='cash-withdrawal-amount-error' role='alert' tabIndex={-1}>
                {validation.errors.amount}
              </p>
            )}
          </div>

          <div>
            <label className='font-semibold text-slate-800' htmlFor='cash-withdrawal-reason'>
              Motif obligatoire
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
              <p className='mt-1.5 text-sm font-medium text-red-700' id='cash-withdrawal-reason-error' role='alert' tabIndex={-1}>
                {validation.errors.reason}
              </p>
            ) : (
              <p className='mt-1.5 text-xs text-slate-500' id='cash-withdrawal-reason-help'>
                Obligatoire, {CASH_WITHDRAWAL_REASON_MAX_LENGTH} caractères maximum.
              </p>
            )}
          </div>

          </div>
          <dl className={styles.livePreview}>
            {[
              ['Solde avant', summary.balanceInCentimes],
              ['Retrait saisi', validation.amountInCentimes],
              ['Solde après', validation.balanceAfterWithdrawalInCentimes],
            ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatReceptionMoney(value)}</dd></div>)}
          </dl>

          {actionState?.stale && (
            <div className='rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950' role='alert' tabIndex={-1}>
              <p className='font-semibold'>Aucun retrait n’a été enregistré.</p>
              <p className='mt-1'>
                {actionState.errors.form} Vérifiez le nouveau récapitulatif puis
                confirmez-le explicitement.
              </p>
            </div>
          )}

          {actionState?.errors?.form && !actionState.stale && !uncertain && (
            <p className='rounded-xl border border-red-200 bg-red-50 p-4 font-semibold text-red-900' role='alert' tabIndex={-1}>
              {actionState.errors.form}
            </p>
          )}

          {actionState?.errors?.amount && !actionState.stale && (
            <p className='rounded-xl border border-red-200 bg-red-50 p-4 font-semibold text-red-900' role='alert' tabIndex={-1}>
              {actionState.errors.amount}
            </p>
          )}

          {uncertain && (
            <aside className='rounded-xl border border-blue-300 bg-blue-50 p-4 text-blue-950' role='alert' tabIndex={-1}>
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
      <div className={styles.formActions}>
        <small>{uncertain ? 'Demande figée · résultat à vérifier' : 'Retrait non enregistré'}</small>
        <button type='button' disabled={pending || uncertain} onClick={onCancel}>Annuler</button>
        <button type='submit' disabled={pending || uncertain || fieldsDisabled}>
          {pending ? 'Enregistrement…' : 'Vérifier le retrait'}
        </button>
      </div>
      <ConfirmationDialog dialogRef={dialogRef} onClose={restoreTriggerFocus} onConfirm={confirmSubmission}
        pending={pending || uncertain} confirmDisabled={!requestIsValid} confirmLabel='Confirmer le retrait'
        title='Confirmer le retrait d’espèces ?' tone='red'>
        <p>Ce retrait définitif diminue le solde suivi. Il ne règle aucune dette livreur et ne constitue pas des frais de tournée.</p>
        <dl className={styles.confirmSummary}>
          {[
            ['Caisse source', summary.cashRegister ? `${summary.cashRegister.name} · ${summary.cashRegister.code}` : 'Indisponible'],
            ['Montant retiré', formatReceptionMoney(validation.amountInCentimes)],
            ['Motif', reason],
            ['Solde suivi avant', Number.isSafeInteger(summary.balanceInCentimes) ? formatReceptionMoney(summary.balanceInCentimes) : 'Non calculable'],
            ['Solde prévu après', Number.isSafeInteger(validation.balanceAfterWithdrawalInCentimes) ? formatReceptionMoney(validation.balanceAfterWithdrawalInCentimes) : 'Non calculable'],
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      </ConfirmationDialog>
    </form>
  );
};

export default CashWithdrawalPreview;
