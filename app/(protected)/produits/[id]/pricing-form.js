'use client';

import { useActionState, useId, useRef, useState } from 'react';

import { updateProductSalePrice } from './pricing-actions.js';

const INITIAL_STATE = {
  errors: {},
  message: null,
  revision: 0,
  values: { price: '' },
};

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

const PricingForm = ({ baseUnitLabel, currentPrice, productId }) => {
  const confirmationGrantedRef = useRef(false);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const titleId = useId();
  const [proposedPrice, setProposedPrice] = useState('');
  const updatePriceWithProductId = updateProductSalePrice.bind(null, productId);
  const [state, formAction, pending] = useActionState(
    updatePriceWithProductId,
    INITIAL_STATE,
  );
  const defaultPrice = state.revision > 0
    ? state.values.price
    : currentPrice;
  const unitLabel = baseUnitLabel.toLocaleLowerCase('fr');

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

  return (
    <form
      action={formAction}
      className='mt-5 rounded-xl border border-slate-200 bg-slate-50 p-5'
      key={state.revision}
      onSubmit={handleSubmit}
    >
      {state.message && (
        <p
          className='mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800'
          role='status'
        >
          {state.message}
        </p>
      )}

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
      <div className='mt-2 flex max-w-sm rounded-lg shadow-sm'>
        <input
          aria-describedby={state.errors.price ? 'sale-price-error' : undefined}
          aria-invalid={Boolean(state.errors.price)}
          className='min-w-0 flex-1 rounded-l-lg border border-r-0 border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-600 aria-invalid:focus:ring-red-100'
          defaultValue={defaultPrice}
          id='sale-price'
          inputMode='decimal'
          min='0.01'
          name='price'
          placeholder='Ex. 150'
          ref={inputRef}
          required
          step='0.01'
          type='number'
        />
        <span className='inline-flex items-center rounded-r-lg border border-slate-300 bg-slate-100 px-4 text-sm font-semibold text-slate-700'>
          DA TTC
        </span>
      </div>
      {state.errors.price && (
        <p className='mt-2 text-sm text-red-700' id='sale-price-error'>
          {state.errors.price}
        </p>
      )}

      <button
        className='mt-4 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
        disabled={pending}
        type='submit'
      >
        {pending ? 'Enregistrement…' : 'Enregistrer le prix'}
      </button>

      <dialog
        aria-labelledby={titleId}
        className='m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-0 text-left shadow-xl backdrop:bg-slate-950/40'
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
              onClick={() => dialogRef.current?.close()}
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
  );
};

export default PricingForm;
