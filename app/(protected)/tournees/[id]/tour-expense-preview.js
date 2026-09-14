'use client';

import { useRef, useState } from 'react';

import ConfirmationDialog from '../../confirmation-dialog.js';
import {
  TOUR_EXPENSE_CHOICE_DECLARE,
  TOUR_EXPENSE_CHOICE_NONE,
  TOUR_EXPENSE_REASON_MAX_LENGTH,
  calculateTourExpensePreview,
} from '../../../../lib/tour-expense-calculations.js';
import { formatReceptionMoney } from '../../../../lib/receptions.js';

const createExpenseLine = (id) => ({
  amount: '',
  id: `expense-${id}`,
  reason: '',
});

const formatExpenseMoney = (amountInCentimes) =>
  Number.isSafeInteger(amountInCentimes)
    ? amountInCentimes < 0
      ? `−${formatReceptionMoney(Math.abs(amountInCentimes))}`
      : formatReceptionMoney(amountInCentimes)
    : 'Calcul incomplet';

const PreviewAmount = ({ label, value }) => (
  <div className='bg-white px-5 py-4 sm:px-6'>
    <dt className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
      {label}
    </dt>
    <dd className='mt-1 text-xl font-bold tabular-nums text-slate-950'>
      {formatExpenseMoney(value)}
    </dd>
  </div>
);

const TourExpensePreview = ({ canDeclareExpenses, preview }) => {
  const dialogRef = useRef(null);
  const previewTriggerRef = useRef(null);
  const nextLineIdRef = useRef(1);
  const [choice, setChoice] = useState('');
  const [expenses, setExpenses] = useState([]);
  const [previewAttempted, setPreviewAttempted] = useState(false);
  const [touchedFields, setTouchedFields] = useState({});
  const calculation = calculateTourExpensePreview({
    choice,
    expenses,
    grossSalesInCentimes: preview.grossSalesInCentimes,
    totalPaidInCentimes: preview.totalPaidInCentimes,
  });

  if (preview.errors?.form) {
    return (
      <section className='mt-8 rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm sm:p-6'>
        <p className='font-semibold text-red-800' role='alert'>
          {preview.errors.form}
        </p>
      </section>
    );
  }

  const addExpense = () => {
    const id = nextLineIdRef.current;
    nextLineIdRef.current += 1;
    setExpenses((current) => [...current, createExpenseLine(id)]);
  };

  const updateExpense = (id, field, value) => {
    setExpenses((current) => current.map((expense) =>
      expense.id === id ? { ...expense, [field]: value } : expense));
  };

  const removeExpense = (id) => {
    setExpenses((current) => current.filter((expense) => expense.id !== id));
    setTouchedFields((current) => Object.fromEntries(
      Object.entries(current).filter(([key]) => !key.startsWith(`${id}:`)),
    ));
  };

  const chooseExpenseMode = (nextChoice) => {
    setChoice(nextChoice);
    setPreviewAttempted(false);

    if (
      nextChoice === TOUR_EXPENSE_CHOICE_DECLARE
      && expenses.length === 0
    ) {
      addExpense();
    }
  };

  const showFieldError = (lineId, field) =>
    previewAttempted || touchedFields[`${lineId}:${field}`];
  const remainingIsRefund = calculation.complete
    && calculation.remainingDueInCentimes < 0;

  return (
    <section
      aria-labelledby='tour-expenses-title'
      className='mt-8 overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 shadow-sm'
    >
      <div className='p-5 sm:p-6'>
        <p className='text-xs font-semibold uppercase tracking-wide text-amber-800'>
          Prévisualisation financière
        </p>
        <h2 className='mt-1 text-lg font-semibold text-slate-950' id='tour-expenses-title'>
          Frais avancés par le livreur
        </h2>
        <p className='mt-2 max-w-3xl text-sm leading-6 text-slate-700'>
          Préparez les frais déductibles du montant à remettre. Ils ne changent
          ni les ventes brutes, ni les quantités, ni les retours et ne créent
          aucun mouvement de caisse.
        </p>
      </div>

      {!canDeclareExpenses ? (
        <div className='border-t border-amber-200 bg-white p-5 sm:p-6'>
          <p className='text-sm font-semibold text-slate-800'>
            La permission de déclaration des frais est nécessaire pour préparer
            cette saisie.
          </p>
          <dl className='mt-4 grid gap-3 sm:grid-cols-2'>
            {[
              ['Ventes brutes issues du comptage', preview.grossSalesInCentimes],
              ['Total déjà encaissé sur la tournée', preview.totalPaidInCentimes],
            ].map(([label, value]) => (
              <div className='rounded-xl bg-slate-50 p-4' key={label}>
                <dt className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
                  {label}
                </dt>
                <dd className='mt-1 font-bold text-slate-950'>
                  {formatExpenseMoney(value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <form
          className='border-t border-amber-200 bg-white p-5 sm:p-6'
          onSubmit={(event) => {
            event.preventDefault();
            setPreviewAttempted(true);

            if (!calculation.complete) {
              return;
            }

            previewTriggerRef.current = event.nativeEvent.submitter;
            dialogRef.current?.showModal();
          }}
        >
          <fieldset>
            <legend className='text-sm font-semibold text-slate-900'>
              Frais pour cette tournée
            </legend>
            <div className='mt-3 grid gap-3 sm:grid-cols-2'>
              {[
                [TOUR_EXPENSE_CHOICE_NONE, 'Aucun frais'],
                [TOUR_EXPENSE_CHOICE_DECLARE, 'Déclarer des frais'],
              ].map(([value, label]) => (
                <label
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 text-sm font-semibold transition ${choice === value ? 'border-amber-500 bg-amber-50 text-amber-950' : 'border-slate-300 bg-white text-slate-800 hover:border-slate-400'}`}
                  key={value}
                >
                  <input
                    checked={choice === value}
                    className='h-4 w-4 accent-amber-700'
                    name='expenseChoice'
                    onChange={() => chooseExpenseMode(value)}
                    type='radio'
                    value={value}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          {previewAttempted && calculation.choiceError && (
            <p className='mt-3 text-sm font-semibold text-red-700' role='alert'>
              {calculation.choiceError}
            </p>
          )}

          {choice === TOUR_EXPENSE_CHOICE_DECLARE && (
            <div className='mt-6'>
              <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                <h3 className='font-semibold text-slate-900'>Lignes de frais</h3>
                <button
                  className='inline-flex items-center justify-center rounded-lg border border-amber-600 bg-white px-4 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-50'
                  onClick={addExpense}
                  type='button'
                >
                  Ajouter une ligne
                </button>
              </div>

              {expenses.length === 0 ? (
                <p className='mt-4 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600'>
                  Ajoutez au moins une ligne pour déclarer des frais.
                </p>
              ) : (
                <div className='mt-4 space-y-4'>
                  {calculation.expenseLines.map((line, index) => {
                    const expense = expenses[index];
                    const amountError = showFieldError(line.id, 'amount')
                      ? line.errors.amount
                      : null;
                    const reasonError = showFieldError(line.id, 'reason')
                      ? line.errors.reason
                      : null;

                    return (
                      <article className='rounded-xl border border-slate-200 bg-slate-50 p-4' key={line.id}>
                        <div className='flex items-center justify-between gap-3'>
                          <h4 className='font-semibold text-slate-900'>
                            Frais {index + 1}
                          </h4>
                          <button
                            aria-label={`Retirer la ligne de frais ${index + 1}`}
                            className='rounded-lg px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50'
                            onClick={() => removeExpense(line.id)}
                            type='button'
                          >
                            Retirer
                          </button>
                        </div>
                        <div className='mt-3 grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]'>
                          <div>
                            <label className='text-sm font-semibold text-slate-800' htmlFor={`${line.id}-reason`}>
                              Motif
                            </label>
                            <input
                              aria-describedby={reasonError ? `${line.id}-reason-error` : undefined}
                              aria-invalid={Boolean(reasonError)}
                              className='mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-100'
                              id={`${line.id}-reason`}
                              onBlur={() => setTouchedFields((current) => ({
                                ...current,
                                [`${line.id}:reason`]: true,
                              }))}
                              onChange={(event) => updateExpense(
                                line.id,
                                'reason',
                                event.target.value,
                              )}
                              placeholder='Ex. péage, stationnement…'
                              type='text'
                              value={expense.reason}
                            />
                            {reasonError && (
                              <p className='mt-1.5 text-sm font-medium text-red-700' id={`${line.id}-reason-error`} role='alert'>
                                {reasonError}
                              </p>
                            )}
                            <p className='mt-1 text-xs text-slate-500'>
                              {line.reason.length}/{TOUR_EXPENSE_REASON_MAX_LENGTH} caractères après nettoyage
                            </p>
                          </div>
                          <div>
                            <label className='text-sm font-semibold text-slate-800' htmlFor={`${line.id}-amount`}>
                              Montant en DA
                            </label>
                            <input
                              aria-describedby={amountError ? `${line.id}-amount-error` : undefined}
                              aria-invalid={Boolean(amountError)}
                              className='mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-100'
                              id={`${line.id}-amount`}
                              inputMode='decimal'
                              onBlur={() => setTouchedFields((current) => ({
                                ...current,
                                [`${line.id}:amount`]: true,
                              }))}
                              onChange={(event) => updateExpense(
                                line.id,
                                'amount',
                                event.target.value,
                              )}
                              placeholder='0,00'
                              type='text'
                              value={expense.amount}
                            />
                            {amountError && (
                              <p className='mt-1.5 text-sm font-medium text-red-700' id={`${line.id}-amount-error`} role='alert'>
                                {amountError}
                              </p>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {calculation.financialError && (
            <p className='mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800' role='alert'>
              {calculation.financialError}
            </p>
          )}

          <div className='mt-6 overflow-hidden rounded-xl border border-slate-200'>
            <dl className='grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-5'>
              <PreviewAmount
                label='Ventes brutes'
                value={calculation.grossSalesInCentimes}
              />
              <PreviewAmount
                label='Total des frais saisis'
                value={calculation.totalExpensesInCentimes}
              />
              <PreviewAmount
                label='Net à remettre prévu'
                value={calculation.netDueInCentimes}
              />
              <PreviewAmount
                label='Total déjà encaissé sur la tournée'
                value={calculation.totalPaidInCentimes}
              />
              <PreviewAmount
                label={remainingIsRefund
                  ? 'À rembourser au livreur'
                  : 'Reste prévu après déduction'}
                value={remainingIsRefund
                  ? calculation.reimbursementDueInCentimes
                  : calculation.remainingDueInCentimes}
              />
            </dl>
          </div>

          {!calculation.complete && choice && (
            <p className='mt-3 text-sm font-medium text-amber-900' role='status'>
              Le calcul reste incomplet tant que toutes les lignes ne sont pas valides.
            </p>
          )}

          {remainingIsRefund && (
            <div className='mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm leading-6 text-violet-950' role='status'>
              <p className='font-semibold'>Remboursement à définir</p>
              <p className='mt-1'>
                L’entreprise devrait rembourser {formatReceptionMoney(calculation.reimbursementDueInCentimes)} au livreur. Cette prévisualisation ne ramène pas l’écart à zéro, ne crée aucun retrait et ne réaffecte aucun versement.
              </p>
            </div>
          )}

          <div className='mt-5 flex justify-end'>
            <button
              className='inline-flex w-full items-center justify-center rounded-lg bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-800 sm:w-auto'
              type='submit'
            >
              Prévisualiser la déclaration
            </button>
          </div>

          <ConfirmationDialog
            confirmDisabled
            confirmLabel='Prévisualisation non sauvegardée'
            dialogRef={dialogRef}
            onClose={() => previewTriggerRef.current?.focus()}
            onConfirm={() => {}}
            title='Prévisualisation des frais avancés'
            tone='amber'
          >
            <p>
              Tournée <strong className='text-slate-950'>{preview.tourReference}</strong>
              {' '}de {preview.deliverer.code} — {preview.deliverer.name}.
            </p>
            <dl className='grid gap-2 rounded-xl bg-slate-50 p-4 sm:grid-cols-2'>
              {[
                ['Ventes brutes', calculation.grossSalesInCentimes],
                ['Total des frais', calculation.totalExpensesInCentimes],
                ['Net à remettre prévu', calculation.netDueInCentimes],
                ['Total déjà encaissé', calculation.totalPaidInCentimes],
                [remainingIsRefund
                  ? 'À rembourser au livreur'
                  : 'Reste prévu', remainingIsRefund
                  ? calculation.reimbursementDueInCentimes
                  : calculation.remainingDueInCentimes],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
                    {label}
                  </dt>
                  <dd className='mt-0.5 font-semibold text-slate-950'>
                    {formatExpenseMoney(value)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className='font-semibold text-amber-900'>
              Aucun frais n’est enregistré dans cet incrément. Le bouton de confirmation reste désactivé.
            </p>
          </ConfirmationDialog>
        </form>
      )}
    </section>
  );
};

export default TourExpensePreview;
