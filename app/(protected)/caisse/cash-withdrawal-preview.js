'use client';

import { useRef, useState } from 'react';

import {
  CASH_WITHDRAWAL_REASON_MAX_LENGTH,
  validateCashWithdrawalPreview,
} from '../../../lib/cash-withdrawal-calculations.js';
import { formatReceptionMoney } from '../../../lib/receptions.js';
import ConfirmationDialog from '../confirmation-dialog.js';

const CashWithdrawalPreview = ({
  cashRegister,
  error,
  recordedReceiptsInCentimes,
}) => {
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState({ amount: false, reason: false });
  const validation = validateCashWithdrawalPreview({ amount, reason });
  const fieldsDisabled = !cashRegister;

  const openPreview = () => {
    setAmount('');
    setReason('');
    setTouched({ amount: false, reason: false });
    dialogRef.current?.showModal();
  };

  return (
    <>
      <button
        className='inline-flex items-center justify-center rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700'
        onClick={openPreview}
        ref={triggerRef}
        type='button'
      >
        Retirer des espèces
      </button>

      <ConfirmationDialog
        confirmDisabled
        confirmLabel='Saisie non sauvegardée'
        dialogRef={dialogRef}
        onClose={() => triggerRef.current?.focus()}
        onConfirm={() => {}}
        title='Préparer un retrait d’espèces'
        tone='red'
      >
        <p>
          Cette prévisualisation ne crée aucun retrait et ne modifie aucun
          encaissement.
        </p>

        {error ? (
          <p className='rounded-xl border border-red-200 bg-red-50 p-4 font-semibold text-red-900' role='alert'>
            {error}
          </p>
        ) : (
          <div className='rounded-xl bg-slate-50 p-4'>
            <p className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
              Caisse concernée
            </p>
            <p className='mt-1 font-semibold text-slate-950'>
              {cashRegister.name} — {cashRegister.code}
            </p>
          </div>
        )}

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
            onBlur={() => setTouched((current) => ({ ...current, amount: true }))}
            onChange={(event) => setAmount(event.target.value)}
            placeholder='0,00'
            type='text'
            value={amount}
          />
          {touched.amount && validation.errors.amount ? (
            <p className='mt-1.5 text-sm font-medium text-red-700' id='cash-withdrawal-amount-error' role='alert'>
              {validation.errors.amount}
            </p>
          ) : touched.amount && validation.amountInCentimes !== null ? (
            <p className='mt-1.5 text-sm text-slate-600'>
              Montant reconnu : {formatReceptionMoney(validation.amountInCentimes)}
            </p>
          ) : null}
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
            onBlur={() => setTouched((current) => ({ ...current, reason: true }))}
            onChange={(event) => setReason(event.target.value)}
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

        <div className='rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950'>
          <p className='font-semibold'>Aucun solde après retrait n’est calculé</p>
          <p className='mt-1'>
            Encaissements enregistrés pour cette caisse :{' '}
            <span className='font-semibold'>
              {recordedReceiptsInCentimes === null
                ? 'Non calculables'
                : formatReceptionMoney(recordedReceiptsInCentimes)}
            </span>.
            Ce total ne prouve pas les espèces physiquement présentes, car le
            fonds initial et les sorties ne sont pas encore suivis.
          </p>
        </div>

        <p className='font-semibold text-red-800'>
          Le bouton reste désactivé : cette saisie n’est pas sauvegardée dans
          ce premier incrément.
        </p>
      </ConfirmationDialog>
    </>
  );
};

export default CashWithdrawalPreview;
