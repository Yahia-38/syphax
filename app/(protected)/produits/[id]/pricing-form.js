'use client';

import Link from 'next/link';
import { useActionState, useEffect, useId, useRef, useState } from 'react';

import { updateProductSalePrice } from './pricing-actions.js';

const INITIAL_STATE = {
  errors: {},
  message: null,
  revision: 0,
  values: { price: '' },
};

const OPEN_PRICE_PANEL_EVENT = 'syphax:open-price-panel';

export const PriceEditLink = ({ productId }) => (
  <Link
    className='rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
    href={`/produits/${productId}?section=tarification&prix=1`}
    onClick={() => window.dispatchEvent(new Event(OPEN_PRICE_PANEL_EVENT))}
  >
    Modifier le prix
  </Link>
);

const formatPrice = (value) => {
  const amount = Number(String(value).replace(',', '.'));

  if (!Number.isFinite(amount) || amount <= 0) {
    return 'Non renseigné';
  }

  return `${new Intl.NumberFormat('fr-DZ', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amount)} DA TTC`;
};

const formatAmount = (amount) => new Intl.NumberFormat('fr-DZ', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
}).format(amount);

const getPriceHelper = (priceValue, currentPriceInCentimes) => {
  const proposedPrice = Number(String(priceValue).replace(',', '.'));

  if (!Number.isFinite(proposedPrice) || proposedPrice <= 0) {
    return 'Saisissez un prix positif.';
  }

  if (!Number.isSafeInteger(currentPriceInCentimes)) {
    return `Le prix de vente sera défini à ${formatAmount(proposedPrice)} DA.`;
  }

  const currentPrice = currentPriceInCentimes / 100;
  const difference = proposedPrice - currentPrice;

  if (Math.abs(difference) < 0.005) {
    return 'Identique au prix actuel.';
  }

  const sign = difference > 0 ? '+' : '−';

  return `${sign}${formatAmount(Math.abs(difference))} DA par rapport au prix actuel (${formatAmount(currentPrice)} DA).`;
};

const PricingForm = ({
  baseUnitLabel,
  currentPrice,
  currentPriceInCentimes,
  initiallyOpen,
  lastChange,
  productId,
}) => {
  const confirmationGrantedRef = useRef(false);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const submitButtonRef = useRef(null);
  const titleId = useId();
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const [priceValue, setPriceValue] = useState(currentPrice);
  const [proposedPrice, setProposedPrice] = useState('');
  const updatePriceWithProductId = updateProductSalePrice.bind(null, productId);
  const runPriceUpdate = async (previousState, formData) => {
    const nextState = await updatePriceWithProductId(previousState, formData);

    setPriceValue(nextState.values.price);
    setIsOpen(!nextState.message);

    return nextState;
  };
  const [state, formAction, pending] = useActionState(
    runPriceUpdate,
    INITIAL_STATE,
  );
  const unitLabel = baseUnitLabel.toLocaleLowerCase('fr');

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    inputRef.current?.focus();
  }, [isOpen, state.revision]);

  useEffect(() => {
    const openPanel = () => setIsOpen(true);

    window.addEventListener(OPEN_PRICE_PANEL_EVENT, openPanel);

    return () => window.removeEventListener(OPEN_PRICE_PANEL_EVENT, openPanel);
  }, []);

  const handleSubmit = (event) => {
    if (confirmationGrantedRef.current) {
      confirmationGrantedRef.current = false;
      return;
    }

    event.preventDefault();
    setProposedPrice(inputRef.current?.value ?? '');
    dialogRef.current?.showModal();
  };

  const confirmSubmission = () => {
    confirmationGrantedRef.current = true;
    dialogRef.current?.close();
  };

  const closeDialog = () => {
    dialogRef.current?.close();
  };

  return (
    <section
      aria-labelledby='pricing-title'
      className='overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'
    >
      <div className='flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-6 py-5'>
        <div>
          <h2
            className='text-lg font-semibold text-slate-900'
            id='pricing-title'
          >
            Prix de vente
          </h2>
          <p className='mt-1 text-sm leading-6 text-slate-600'>
            TTC, appliqué à l’unité de base. Chaque changement est historisé.
          </p>
        </div>
        {!isOpen && (
          <button
            className='rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            onClick={() => setIsOpen(true)}
            type='button'
          >
            Modifier
          </button>
        )}
      </div>

      <div className='flex flex-wrap gap-5 p-6'>
        <div className='flex-[1_1_260px] rounded-xl border border-emerald-100 bg-emerald-50 p-5'>
          <p className='text-[12px] font-bold uppercase tracking-[0.08em] text-emerald-700'>
            Prix de vente actuel
          </p>
          {Number.isSafeInteger(currentPriceInCentimes) ? (
            <>
              <p className='mt-2 flex flex-wrap items-baseline gap-2'>
                <span className='text-[40px] leading-[44px] font-bold text-emerald-900'>
                  {formatAmount(currentPriceInCentimes / 100)}
                </span>
                <span className='text-base font-semibold text-emerald-700'>
                  DA TTC
                </span>
              </p>
              {lastChange && (
                <p className='mt-3 text-xs leading-5 text-emerald-800'>
                  Dernière modification le {lastChange.date} · {lastChange.author}
                </p>
              )}
            </>
          ) : (
            <p className='mt-3 text-2xl font-semibold text-slate-500'>
              Non renseigné
            </p>
          )}
        </div>

        <div className='flex-[1_1_260px] rounded-xl border border-slate-200 bg-slate-50 p-5'>
          <p className='text-[12px] font-bold uppercase tracking-[0.08em] text-slate-600'>
            Dernier coût d’achat accepté
          </p>
          <p className='mt-3 text-2xl font-semibold text-slate-500'>
            Non disponible
          </p>
          <p className='mt-3 text-xs leading-5 text-slate-500'>
            Disponible après l’intégration et le traitement des factures.
          </p>
        </div>
      </div>

      {state.message && !isOpen && (
        <p
          className='border-t border-emerald-100 bg-emerald-50 px-6 py-3.5 text-sm font-semibold text-emerald-700'
          role='status'
        >
          Prix de vente mis à jour.
        </p>
      )}

      {isOpen && (
        <form
          action={formAction}
          className='border-t border-slate-100 bg-slate-50 p-6'
          onSubmit={handleSubmit}
        >
          {state.errors.form && (
            <p
              className='mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'
              role='alert'
            >
              {state.errors.form}
            </p>
          )}

          <label
            className='block text-sm font-medium text-slate-700'
            htmlFor='sale-price'
          >
            Prix de vente par {unitLabel}
          </label>
          <div className='mt-2 flex flex-wrap items-center gap-4'>
            <div className='flex rounded-lg shadow-sm'>
              <input
                aria-describedby={
                  state.errors.price
                    ? 'sale-price-error sale-price-helper'
                    : 'sale-price-helper'
                }
                aria-invalid={Boolean(state.errors.price)}
                className='w-[220px] rounded-l-lg border border-r-0 border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-600 aria-invalid:focus:ring-red-100'
                id='sale-price'
                inputMode='decimal'
                min='0.01'
                name='price'
                onChange={(event) => setPriceValue(event.target.value)}
                placeholder='Ex. 150'
                ref={inputRef}
                required
                step='0.01'
                type='number'
                value={priceValue}
              />
              <span className='inline-flex items-center rounded-r-lg border border-slate-300 bg-slate-100 px-4 text-sm font-semibold text-slate-700'>
                DA
              </span>
            </div>
            <p
              aria-live='polite'
              className='text-sm text-slate-600'
              id='sale-price-helper'
            >
              {getPriceHelper(priceValue, currentPriceInCentimes)}
            </p>
          </div>
          {state.errors.price && (
            <p className='mt-2 text-sm text-red-700' id='sale-price-error'>
              {state.errors.price}
            </p>
          )}

          <div className='mt-5 flex flex-wrap gap-3'>
            <button
              className='rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
              disabled={pending}
              ref={submitButtonRef}
              type='submit'
            >
              {pending ? 'Enregistrement…' : 'Enregistrer le prix'}
            </button>
            <button
              className='rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
              disabled={pending}
              onClick={() => setIsOpen(false)}
              type='button'
            >
              Annuler
            </button>
          </div>

          <dialog
            aria-labelledby={titleId}
            className='m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-0 text-left shadow-xl backdrop:bg-slate-950/40'
            onClose={() => submitButtonRef.current?.focus()}
            ref={dialogRef}
          >
            <div className='p-6'>
              <div className='flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 text-xl font-semibold text-blue-700'>
                ?
              </div>
              <h2
                className='mt-4 text-xl font-semibold text-slate-900'
                id={titleId}
              >
                Confirmer le changement de prix ?
              </h2>
              <p className='mt-2 text-sm leading-6 text-slate-600'>
                Le prix de vente par {unitLabel} passera de{' '}
                <strong>{formatPrice(currentPrice)}</strong> à{' '}
                <strong>{formatPrice(proposedPrice)}</strong>.
              </p>
              <p className='mt-3 text-sm leading-6 text-slate-600'>
                L’ancien et le nouveau prix seront conservés dans l’historique.
              </p>

              <div className='mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end'>
                <button
                  className='rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
                  disabled={pending}
                  onClick={closeDialog}
                  type='button'
                >
                  Annuler
                </button>
                <button
                  className='rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
                  disabled={pending}
                  onClick={confirmSubmission}
                  type='submit'
                >
                  {pending ? 'Enregistrement…' : 'Confirmer le nouveau prix'}
                </button>
              </div>
            </div>
          </dialog>
        </form>
      )}
    </section>
  );
};

export default PricingForm;
