'use client';

import { useActionState, useRef, useState } from 'react';

import ConfirmationDialog, {
  useFormConfirmation,
} from '../../confirmation-dialog.js';
import {
  TOUR_EXPENSE_CHOICE_DECLARE,
  TOUR_EXPENSE_CHOICE_NONE,
  TOUR_EXPENSE_REASON_MAX_LENGTH,
  calculateTourExpensePreview,
} from '../../../../lib/tour-expense-calculations.js';
import { formatReceptionMoney } from '../../../../lib/receptions.js';
import { declareTourExpenses } from './actions.js';

const DECLARATION_LINES_PER_PAGE = 5;
const INITIAL_STATE = {
  confirmationKey: null,
  errors: {},
  message: null,
  replayed: false,
  revision: 0,
  stale: false,
  succeeded: false,
};

const createExpenseLine = (id) => ({
  amount: '',
  id: `expense-${id}`,
  reason: '',
});

const formatExpenseDate = (value) => {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? 'Date indisponible'
    : new Intl.DateTimeFormat('fr-DZ', {
        dateStyle: 'long',
        hourCycle: 'h23',
        timeStyle: 'short',
        timeZone: 'Africa/Algiers',
      }).format(date);
};

const PreviewAmount = ({ label, value }) => (
  <div className='bg-white px-5 py-4 sm:px-6'>
    <dt className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
      {label}
    </dt>
    <dd className='mt-1 text-xl font-bold tabular-nums text-slate-950'>
      {Number.isSafeInteger(value)
        ? formatReceptionMoney(value)
        : 'Calcul incomplet'}
    </dd>
  </div>
);

const FinancialSummary = ({ values }) => (
  <dl className='grid gap-px border-t border-amber-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-5'>
    {values.map(([label, value]) => (
      <PreviewAmount key={label} label={label} value={value} />
    ))}
  </dl>
);

const TourExpensePreview = ({
  canDeclareExpenses,
  initialConfirmationKey,
  preview,
  tourId,
}) => {
  const declareCurrentExpenses = declareTourExpenses.bind(null, tourId);
  const [state, formAction, pending] = useActionState(
    declareCurrentExpenses,
    INITIAL_STATE,
  );
  const nextLineIdRef = useRef(1);
  const [choice, setChoice] = useState('');
  const [expenses, setExpenses] = useState([]);
  const [previewAttempted, setPreviewAttempted] = useState(false);
  const [touchedFields, setTouchedFields] = useState({});
  const [lineQuery, setLineQuery] = useState('');
  const [linePage, setLinePage] = useState(1);
  const {
    confirmSubmission,
    dialogRef,
    requestConfirmation,
    restoreTriggerFocus,
  } = useFormConfirmation();
  const calculation = calculateTourExpensePreview({
    choice,
    expenses,
    grossSalesInCentimes: preview.grossSalesInCentimes,
    totalPaidInCentimes: preview.totalPaidInCentimes,
  });
  const declaration = preview.declaration;
  const confirmationKey = state.confirmationKey ?? initialConfirmationKey;
  const normalizedLineQuery = lineQuery.trim().toLocaleLowerCase('fr');
  const filteredDeclarationLines = declaration?.lines.filter((line) =>
    !normalizedLineQuery
    || line.reason.toLocaleLowerCase('fr').includes(normalizedLineQuery)
    || formatReceptionMoney(line.amountInCentimes)
      .toLocaleLowerCase('fr')
      .includes(normalizedLineQuery)) ?? [];
  const linePageCount = Math.max(
    1,
    Math.ceil(filteredDeclarationLines.length / DECLARATION_LINES_PER_PAGE),
  );
  const activeLinePage = Math.min(linePage, linePageCount);
  const paginatedDeclarationLines = filteredDeclarationLines.slice(
    (activeLinePage - 1) * DECLARATION_LINES_PER_PAGE,
    activeLinePage * DECLARATION_LINES_PER_PAGE,
  );

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
  const summaryValues = declaration
    ? [
        ['Ventes brutes', preview.grossSalesInCentimes],
        ['Frais déclarés', declaration.totalExpensesInCentimes],
        ['Net à remettre', preview.netDueInCentimes],
        ['Total encaissé', preview.totalPaidInCentimes],
        ['Reste à payer', preview.remainingDueInCentimes],
      ]
    : [
        ['Ventes brutes', calculation.grossSalesInCentimes],
        ['Frais saisis', calculation.totalExpensesInCentimes],
        ['Net à remettre prévu', calculation.netDueInCentimes],
        ['Total encaissé', calculation.totalPaidInCentimes],
        ['Reste prévu', calculation.remainingDueInCentimes],
      ];

  return (
    <section
      aria-labelledby='tour-expenses-title'
      className='mt-8 overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 shadow-sm'
    >
      <div className='p-5 sm:p-6'>
        <p className='text-xs font-semibold uppercase tracking-wide text-amber-800'>
          Situation financière
        </p>
        <h2 className='mt-1 text-lg font-semibold text-slate-950' id='tour-expenses-title'>
          Frais avancés par le livreur
        </h2>
        <p className='mt-2 max-w-3xl text-sm leading-6 text-slate-700'>
          Les frais diminuent le net à remettre sans modifier les ventes
          brutes, le stock, les retours ni le solde de caisse.
        </p>
      </div>

      {declaration ? (
        <>
          <FinancialSummary values={summaryValues} />
          <div className='border-t border-amber-200 bg-white p-5 sm:p-6'>
            <div className='rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950'>
              <p className='font-semibold'>
                Déclaration définitive enregistrée
              </p>
              <p className='mt-1'>
                {declaration.choice === TOUR_EXPENSE_CHOICE_NONE
                  ? 'Aucun frais déclaré explicitement.'
                  : `${declaration.lines.length} ligne${declaration.lines.length > 1 ? 's' : ''} de frais.`}
                {' '}Déclarée par {declaration.declaredBy ?? 'Compte indisponible'} le{' '}
                {formatExpenseDate(declaration.declaredAt)}.
              </p>
            </div>

            {declaration.lines.length > 0 && (
              <div className='mt-5'>
                <div className='flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
                  <div>
                    <h3 className='font-semibold text-slate-950'>
                      Détail des frais
                    </h3>
                    <p className='mt-1 text-xs text-slate-500'>
                      Lecture seule — aucune modification ni suppression.
                    </p>
                  </div>
                  <div className='w-full sm:max-w-sm'>
                    <label className='sr-only' htmlFor='expense-line-search'>
                      Rechercher un motif ou un montant
                    </label>
                    <input
                      className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
                      id='expense-line-search'
                      onChange={(event) => {
                        setLineQuery(event.target.value);
                        setLinePage(1);
                      }}
                      placeholder='Rechercher un motif ou un montant'
                      type='search'
                      value={lineQuery}
                    />
                  </div>
                </div>

                {paginatedDeclarationLines.length > 0 ? (
                  <div className='mt-4 space-y-3'>
                    {paginatedDeclarationLines.map((line, index) => (
                      <article className='flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-start sm:justify-between' key={`${line.reason}-${line.amountInCentimes}-${index}`}>
                        <p className='whitespace-pre-wrap text-sm font-medium text-slate-800'>
                          {line.reason}
                        </p>
                        <p className='font-bold tabular-nums text-slate-950'>
                          {formatReceptionMoney(line.amountInCentimes)}
                        </p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className='mt-4 rounded-xl border border-slate-200 p-5 text-center text-sm text-slate-600'>
                    Aucune ligne ne correspond à cette recherche.
                  </p>
                )}

                {linePageCount > 1 && (
                  <nav aria-label='Pagination des frais déclarés' className='mt-4 flex items-center justify-between gap-3'>
                    <button
                      className='rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50'
                      disabled={activeLinePage === 1}
                      onClick={() => setLinePage((page) => page - 1)}
                      type='button'
                    >
                      Précédent
                    </button>
                    <p className='text-sm text-slate-600'>
                      Page {activeLinePage} sur {linePageCount}
                    </p>
                    <button
                      className='rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50'
                      disabled={activeLinePage === linePageCount}
                      onClick={() => setLinePage((page) => page + 1)}
                      type='button'
                    >
                      Suivant
                    </button>
                  </nav>
                )}
              </div>
            )}
          </div>
        </>
      ) : preview.declarationStatus === 'HISTORICAL_MISSING' ? (
        <>
          <FinancialSummary values={[
            ['Ventes brutes', preview.grossSalesInCentimes],
            ['Frais', 0],
            ['Net historique', preview.netDueInCentimes],
            ['Total encaissé', preview.totalPaidInCentimes],
            ['Reste à payer', preview.remainingDueInCentimes],
          ]} />
          <p className='border-t border-amber-200 bg-white px-5 py-5 text-sm leading-6 text-amber-950 sm:px-6'>
            Cette tournée a été clôturée avant l’introduction des déclarations
            de frais. Aucune déclaration rétroactive n’a été créée ; ses
            versements restants restent possibles selon son dû historique.
          </p>
        </>
      ) : !canDeclareExpenses ? (
        <div className='border-t border-amber-200 bg-white p-5 sm:p-6'>
          <p className='text-sm font-semibold text-slate-800'>
            Les frais ne sont pas encore déclarés. La permission de déclaration
            est nécessaire pour finaliser cette étape.
          </p>
          <dl className='mt-4 grid gap-3 sm:grid-cols-3'>
            {[
              ['Ventes brutes', preview.grossSalesInCentimes],
              ['Total encaissé', preview.totalPaidInCentimes],
              ['Maximum déclarable', preview.maximumExpensesInCentimes],
            ].map(([label, value]) => (
              <PreviewAmount key={label} label={label} value={value} />
            ))}
          </dl>
        </div>
      ) : (
        <form
          action={formAction}
          className='border-t border-amber-200 bg-white p-5 sm:p-6'
          onSubmit={(event) => {
            setPreviewAttempted(true);

            if (!calculation.complete) {
              event.preventDefault();
              return;
            }

            requestConfirmation(event);
          }}
        >
          <p className='mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950'>
            Les frais ne sont pas encore déclarés. Maximum actuellement
            déclarable : <strong>{formatReceptionMoney(preview.maximumExpensesInCentimes)}</strong>.
            Les encaissements restent possibles avant cette déclaration.
          </p>

          <fieldset disabled={pending}>
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
                  className='inline-flex items-center justify-center rounded-lg border border-amber-600 bg-white px-4 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-50 disabled:opacity-50'
                  disabled={pending}
                  onClick={addExpense}
                  type='button'
                >
                  Ajouter une ligne
                </button>
              </div>

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
                          className='rounded-lg px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50'
                          disabled={pending}
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
                            className='mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm'
                            disabled={pending}
                            id={`${line.id}-reason`}
                            maxLength={TOUR_EXPENSE_REASON_MAX_LENGTH}
                            name='expenseReason'
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
                        </div>
                        <div>
                          <label className='text-sm font-semibold text-slate-800' htmlFor={`${line.id}-amount`}>
                            Montant en DA
                          </label>
                          <input
                            aria-describedby={amountError ? `${line.id}-amount-error` : undefined}
                            aria-invalid={Boolean(amountError)}
                            className='mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm'
                            disabled={pending}
                            id={`${line.id}-amount`}
                            inputMode='decimal'
                            name='expenseAmount'
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
            </div>
          )}

          {calculation.financialError && (
            <p className='mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800' role='alert'>
              {calculation.financialError}
            </p>
          )}

          <div className='mt-6 overflow-hidden rounded-xl border border-slate-200'>
            <FinancialSummary values={summaryValues} />
          </div>

          {state.errors.form && (
            <p className='mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800' role='alert'>
              {state.errors.form}
              {state.stale
                ? ' Les montants affichés ont été actualisés ; vérifiez-les puis confirmez à nouveau.'
                : ''}
            </p>
          )}

          {state.message && (
            <p className='mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800' role='status'>
              {state.message}
            </p>
          )}

          <input name='confirmationKey' type='hidden' value={confirmationKey} />
          <input name='expenseDigest' type='hidden' value={preview.digest} />

          <div className='mt-5 flex justify-end'>
            <button
              className='inline-flex w-full items-center justify-center rounded-lg bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-800 disabled:opacity-50 sm:w-auto'
              disabled={pending}
              type='submit'
            >
              {pending ? 'Enregistrement…' : 'Enregistrer la déclaration'}
            </button>
          </div>

          <ConfirmationDialog
            confirmLabel='Enregistrer définitivement'
            dialogRef={dialogRef}
            onClose={restoreTriggerFocus}
            onConfirm={confirmSubmission}
            pending={pending}
            pendingLabel='Enregistrement…'
            title='Confirmer la déclaration de frais ?'
            tone='amber'
          >
            <p>
              Tournée <strong className='text-slate-950'>{preview.tourReference}</strong>
              {' '}de {preview.deliverer.code} — {preview.deliverer.name}.
            </p>
            <dl className='grid gap-2 rounded-xl bg-slate-50 p-4 sm:grid-cols-2'>
              {summaryValues.map(([label, value]) => (
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
            <p className='font-semibold text-amber-900'>
              Cette déclaration est définitive et ne pourra être ni modifiée ni supprimée dans cet incrément.
            </p>
          </ConfirmationDialog>
        </form>
      )}
    </section>
  );
};

export default TourExpensePreview;
