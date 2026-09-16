'use client';

import { useTourActionState } from './tour-operation-context.js';

import { useState } from 'react';

import { formatReceptionMoney } from '../../../../lib/receptions.js';
import { recordTourPayment } from '../../cash-payment-actions.js';
import CashPaymentForm from '../../cash-payment-form.js';

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

const TourPaymentPreview = ({
  canCreatePayment,
  initialConfirmationKey,
  preview,
  tourId,
  embedded = false,
}) => {
  const [state, formAction, pending] = useTourActionState(
    recordTourPayment,
    INITIAL_STATE,
  );
  const [opened, setOpened] = useState(embedded);
  const [query, setQuery] = useState('');
  const [author, setAuthor] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const remainingDueInCentimes = preview.remainingDueInCentimes;
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
      <section className={embedded ? 'tour-embedded p-5' : 'mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6'}>
        <p className='font-semibold text-red-800' role='alert' tabIndex={-1}>
          {preview.errors.form}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={embedded ? undefined : 'tour-payment-title'} aria-label={embedded ? 'Versements en espèces' : undefined}
      className={embedded ? 'tour-embedded' : 'mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm'}
    >
      {!embedded && <div className='flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6'>
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
          {preview.expenseDeclarationStatus === 'MISSING' && (
            <p className='mt-2 text-sm font-semibold text-blue-800'>
              Frais non encore déclarés : le net reste égal aux ventes brutes
              et pourra encore diminuer dans la limite des encaissements.
            </p>
          )}
          {preview.expenseDeclarationStatus === 'HISTORICAL_MISSING' && (
            <p className='mt-2 text-sm font-semibold text-slate-700'>
              Tournée historique clôturée sans déclaration de frais.
            </p>
          )}
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
      </div>}

      {payments.length === 0 && (
        <p className='border-t border-amber-200 bg-white/70 px-5 py-4 text-sm font-medium text-slate-700 sm:px-6'>
          Aucun versement enregistré
        </p>
      )}

      {preview.errors?.cashRegister && !nothingToCollect && (
        <p className='border-t border-amber-200 bg-white/70 px-5 py-4 text-sm font-medium text-red-700 sm:px-6' role='alert' tabIndex={-1}>
          {preview.errors.cashRegister}
        </p>
      )}

      {state.message && (
        <p className='border-t border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-800 sm:px-6' role='status'>
          {state.message}
        </p>
      )}

      {embedded && <p className='px-5 pt-4 text-sm font-semibold'>{preview.tourReference} · {preview.deliverer.code} — {preview.deliverer.name}</p>}
      {preview.expenseDeclarationStatus === 'MISSING' && embedded && <p className='px-5 pt-2 text-sm text-amber-800'>Frais non déclarés : ce versement peut réduire le maximum déclarable.</p>}
      {opened
        && !nothingToCollect
        && canCreatePayment
        && preview.cashRegister && (
        <div className='border-t border-amber-200 bg-white/70 p-5 sm:p-6'>
          <CashPaymentForm
            cashRegister={preview.cashRegister}
            confirmationKey={confirmationKey}
            deliverer={preview.deliverer}
            formAction={formAction}
            idPrefix='tour-payment'
            pending={pending}
            remainingDueInCentimes={remainingDueInCentimes}
            state={state}
            tourId={tourId}
            tourReference={preview.tourReference}
          />
        </div>
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
