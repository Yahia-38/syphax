'use client';

import { useActionState, useMemo, useState } from 'react';

import { calculateCashPaymentPreview } from '../../../../lib/cash-payment-calculations.js';
import { formatReceptionMoney } from '../../../../lib/receptions.js';
import { recordTourPayment } from './actions.js';

const PAYMENTS_PER_PAGE = 5;
const INITIAL_STATE = {
  confirmationKey: null,
  errors: {},
  message: null,
  paymentReference: null,
  replayed: false,
  revision: 0,
  succeeded: false,
  values: { amount: '', note: '' },
};

const formatPaymentDate = (value) => {
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

const TourPaymentForm = ({
  cashRegister,
  confirmationKey,
  deliverer,
  formAction,
  pending,
  remainingDueInCentimes,
  state,
  tourReference,
}) => {
  const [amount, setAmount] = useState(state.values?.amount ?? '');
  const [note, setNote] = useState(state.values?.note ?? '');
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
  const confirmation = calculation.amountInCentimes
    ? [
        'Confirmer l’argent effectivement reçu pour cette tournée ?',
        '',
        `Livreur : ${deliverer.code} — ${deliverer.name}`,
        `Tournée : ${tourReference}`,
        `Caisse : ${cashRegister.name} (${cashRegister.code})`,
        `Montant reçu : ${formatReceptionMoney(calculation.amountInCentimes)}`,
        `Reste prévu : ${formatReceptionMoney(calculation.remainingAfterPaymentInCentimes)}`,
      ].join('\n')
    : '';

  return (
    <form
      action={formAction}
      className='border-t border-amber-200 bg-white/70 p-5 sm:p-6'
      onSubmit={(event) => {
        if (
          !event.nativeEvent.submitter
          || calculation.remainingAfterPaymentInCentimes === null
          || !globalThis.confirm(confirmation)
        ) {
          event.preventDefault();
        }
      }}
    >
      <div className='rounded-xl border border-amber-200 bg-amber-100 px-4 py-3 text-sm text-amber-950'>
        Caisse destinataire : <strong>{cashRegister.name}</strong>
        {' '}({cashRegister.code}, DZD)
      </div>

      <div className='mt-5 grid gap-5 lg:grid-cols-2'>
        <div>
          <label className='text-sm font-semibold text-slate-800' htmlFor='tour-payment-amount'>
            Montant réellement reçu en DA
          </label>
          <input
            aria-describedby={amountError ? 'tour-payment-amount-error' : undefined}
            aria-invalid={Boolean(amountError)}
            className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-100'
            id='tour-payment-amount'
            inputMode='decimal'
            name='amount'
            onChange={(event) => setAmount(event.target.value)}
            placeholder='Ex. 5000'
            type='text'
            value={amount}
          />
          {amountError && (
            <p className='mt-2 text-sm font-medium text-red-700' id='tour-payment-amount-error' role='alert'>
              {amountError}
            </p>
          )}
        </div>

        <div>
          <label className='text-sm font-semibold text-slate-800' htmlFor='tour-payment-note'>
            Note facultative
          </label>
          <textarea
            aria-describedby={serverNoteError ? 'tour-payment-note-error' : undefined}
            aria-invalid={Boolean(serverNoteError)}
            className='mt-2 min-h-24 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-100'
            id='tour-payment-note'
            maxLength={500}
            name='note'
            onChange={(event) => setNote(event.target.value)}
            placeholder='Précision sur le versement'
            value={note}
          />
          {serverNoteError && (
            <p className='mt-2 text-sm font-medium text-red-700' id='tour-payment-note-error' role='alert'>
              {serverNoteError}
            </p>
          )}
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

      {state.errors.form && (
        <p className='mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800' role='alert'>
          {state.errors.form}
        </p>
      )}

      <input name='confirmationKey' type='hidden' value={confirmationKey} />
      <input
        name='expectedCashRegisterId'
        type='hidden'
        value={cashRegister.id}
      />

      <div className='mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <p className='max-w-2xl text-sm leading-6 text-slate-600'>
          La confirmation enregistre l’argent effectivement reçu. Le versement
          sera conservé sans modification ni suppression.
        </p>
        <button
          className='inline-flex w-full items-center justify-center rounded-lg bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto'
          disabled={pending
            || calculation.remainingAfterPaymentInCentimes === null}
          type='submit'
        >
          {pending ? 'Enregistrement…' : 'Confirmer le versement'}
        </button>
      </div>
    </form>
  );
};

const TourPaymentPreview = ({
  canCreatePayment,
  initialConfirmationKey,
  preview,
  tourId,
}) => {
  const recordCurrentTourPayment = recordTourPayment.bind(null, tourId);
  const [state, formAction, pending] = useActionState(
    recordCurrentTourPayment,
    INITIAL_STATE,
  );
  const [opened, setOpened] = useState(false);
  const [query, setQuery] = useState('');
  const [author, setAuthor] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const remainingDueInCentimes = preview.remainingDueInCentimes ?? 0;
  const payments = Array.isArray(preview.payments) ? preview.payments : [];
  const authors = [...new Set(
    payments.map((payment) => payment.receivedBy).filter(Boolean),
  )].sort((firstAuthor, secondAuthor) =>
    firstAuthor.localeCompare(secondAuthor, 'fr'));
  const normalizedQuery = query.trim().toLocaleLowerCase('fr');
  const filteredPayments = payments.filter((payment) => {
    const matchesAuthor = author === 'ALL' || payment.receivedBy === author;
    const matchesQuery = !normalizedQuery || [
      payment.reference,
      payment.note,
      payment.receivedBy,
    ].some((value) => typeof value === 'string'
      && value.toLocaleLowerCase('fr').includes(normalizedQuery));

    return matchesAuthor && matchesQuery;
  });
  const totalPages = Math.max(
    1,
    Math.ceil(filteredPayments.length / PAYMENTS_PER_PAGE),
  );
  const activePage = Math.min(currentPage, totalPages);
  const paginatedPayments = filteredPayments.slice(
    (activePage - 1) * PAYMENTS_PER_PAGE,
    activePage * PAYMENTS_PER_PAGE,
  );
  const nothingToCollect = remainingDueInCentimes === 0;
  const cashRegisterAvailable = Boolean(preview.cashRegister);
  const confirmationKey = state.confirmationKey ?? initialConfirmationKey;

  if (preview.errors?.form) {
    return (
      <section className='mt-8 rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm sm:p-6'>
        <p className='font-semibold text-red-800' role='alert'>
          {preview.errors.form}
        </p>
      </section>
    );
  }

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
            {nothingToCollect ? 'Soldée' : 'Versements en espèces'}
          </h2>
          <p className='mt-2 max-w-3xl text-sm leading-6 text-slate-600'>
            Ces chiffres concernent uniquement cette tournée. Ils ne représentent
            ni le solde global du livreur, ni l’inventaire réel du tiroir-caisse.
          </p>
        </div>

        {!nothingToCollect
          && canCreatePayment
          && cashRegisterAvailable && (
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

      <dl className='grid gap-px border-t border-amber-200 bg-amber-200 sm:grid-cols-3'>
        {[
          ['Dû pour cette tournée', preview.amountDueInCentimes],
          ['Encaissé pour cette tournée', preview.amountPaidInCentimes],
          ['Reste dû pour cette tournée', remainingDueInCentimes],
        ].map(([label, value]) => (
          <div className='bg-white/80 px-5 py-4 sm:px-6' key={label}>
            <dt className='text-xs font-semibold uppercase tracking-wide text-amber-800'>
              {label}
            </dt>
            <dd className='mt-1 text-xl font-bold tabular-nums text-slate-950'>
              {formatReceptionMoney(value)}
            </dd>
          </div>
        ))}
      </dl>

      {payments.length === 0 && (
        <p className='border-t border-amber-200 bg-white/70 px-5 py-4 text-sm font-medium text-slate-700 sm:px-6'>
          Aucun versement enregistré
        </p>
      )}

      {preview.errors?.cashRegister && !nothingToCollect && (
        <p className='border-t border-amber-200 bg-white/70 px-5 py-4 text-sm font-medium text-red-700 sm:px-6' role='alert'>
          {preview.errors.cashRegister}
        </p>
      )}

      {state.message && (
        <p className='border-t border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-800 sm:px-6' role='status'>
          {state.message}
        </p>
      )}

      {opened
        && !nothingToCollect
        && canCreatePayment
        && preview.cashRegister && (
        <TourPaymentForm
          cashRegister={preview.cashRegister}
          confirmationKey={confirmationKey}
          deliverer={preview.deliverer}
          formAction={formAction}
          key={confirmationKey}
          pending={pending}
          remainingDueInCentimes={remainingDueInCentimes}
          state={state}
          tourReference={preview.tourReference}
        />
      )}

      {payments.length > 0 && (
        <div className='border-t border-amber-200 bg-white/70 p-5 sm:p-6'>
          <div className='flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between'>
            <div>
              <p className='text-xs font-semibold uppercase tracking-wide text-amber-700'>
                Historique de cette tournée
              </p>
              <h3 className='mt-1 font-semibold text-slate-900'>
                {preview.paymentCount} versement{preview.paymentCount > 1 ? 's' : ''}
              </h3>
            </div>
          </div>

          <div className='mt-4 grid gap-3 sm:grid-cols-2'>
            <div>
              <label className='text-sm font-semibold text-slate-800' htmlFor='tour-payment-search'>
                Rechercher
              </label>
              <input
                className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
                id='tour-payment-search'
                onChange={(event) => {
                  setQuery(event.target.value);
                  setCurrentPage(1);
                }}
                placeholder='Référence, note ou auteur'
                type='search'
                value={query}
              />
            </div>
            <div>
              <label className='text-sm font-semibold text-slate-800' htmlFor='tour-payment-author'>
                Auteur
              </label>
              <select
                className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
                id='tour-payment-author'
                onChange={(event) => {
                  setAuthor(event.target.value);
                  setCurrentPage(1);
                }}
                value={author}
              >
                <option value='ALL'>Tous les auteurs</option>
                {authors.map((authorName) => (
                  <option key={authorName} value={authorName}>{authorName}</option>
                ))}
              </select>
            </div>
          </div>

          {paginatedPayments.length > 0 ? (
            <div className='mt-4 space-y-3'>
              {paginatedPayments.map((payment) => (
                <article className='rounded-xl border border-slate-200 bg-white px-4 py-4' key={payment.id}>
                  <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
                    <div>
                      <p className='font-mono text-sm font-semibold text-slate-900'>
                        {payment.reference}
                      </p>
                      <p className='mt-1 text-sm text-slate-600'>
                        {formatPaymentDate(payment.receivedAt)} · par{' '}
                        {payment.receivedBy ?? 'Compte indisponible'}
                      </p>
                      {payment.note && (
                        <p className='mt-2 whitespace-pre-wrap text-sm text-slate-700'>
                          {payment.note}
                        </p>
                      )}
                    </div>
                    <p className='text-lg font-bold tabular-nums text-emerald-800'>
                      {formatReceptionMoney(payment.amountInCentimes)}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className='mt-4 rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-600'>
              Aucun versement ne correspond aux filtres.
            </p>
          )}

          {totalPages > 1 && (
            <nav aria-label='Pagination des versements' className='mt-4 flex items-center justify-between gap-3'>
              <button
                className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50'
                disabled={activePage <= 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                type='button'
              >
                Précédent
              </button>
              <p className='text-sm text-slate-600'>
                Page {activePage} sur {totalPages}
              </p>
              <button
                className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50'
                disabled={activePage >= totalPages}
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                type='button'
              >
                Suivant
              </button>
            </nav>
          )}
        </div>
      )}
    </section>
  );
};

export default TourPaymentPreview;
