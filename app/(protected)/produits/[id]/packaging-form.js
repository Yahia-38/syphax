'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';

import {
  addProductPackaging,
  removePackagingAction,
} from './packaging-actions.js';

const INITIAL_STATE = {
  errors: {},
  message: null,
  revision: 0,
  values: { label: '', quantity: '' },
};

const REMOVE_INITIAL_STATE = {
  error: null,
  revision: 0,
  success: false,
};

const PackagingRemovalButton = ({ packaging, product }) => {
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const titleId = useId();
  const removePackaging = removePackagingAction.bind(
    null,
    product.id,
    packaging.id,
  );
  const [state, formAction, pending] = useActionState(
    removePackaging,
    REMOVE_INITIAL_STATE,
  );

  useEffect(() => {
    if (state.success) {
      dialogRef.current?.close();
    }
  }, [state.revision, state.success]);

  return (
    <>
      <button
        className='text-sm font-medium text-red-700 transition hover:text-red-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700'
        onClick={() => dialogRef.current?.showModal()}
        ref={triggerRef}
        type='button'
      >
        Retirer
      </button>

      <dialog
        aria-labelledby={titleId}
        className='m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-0 text-left shadow-xl backdrop:bg-slate-950/40'
        onClose={() => triggerRef.current?.focus()}
        ref={dialogRef}
      >
        <form action={formAction} className='p-6'>
          <div className='flex h-11 w-11 items-center justify-center rounded-full bg-red-100 text-xl text-red-700'>
            !
          </div>
          <h2
            className='mt-4 text-xl font-semibold text-slate-900'
            id={titleId}
          >
            Retirer ce conditionnement ?
          </h2>
          <p className='mt-2 text-sm leading-6 text-slate-600'>
            Le conditionnement <strong>{packaging.label}</strong> sera retiré
            du produit <strong>{product.code}</strong> — {product.designation}.
            Cette action est irréversible.
          </p>

          {state.error && (
            <p
              className='mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'
              role='alert'
            >
              {state.error}
            </p>
          )}

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
              className='rounded-lg bg-red-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-60'
              disabled={pending}
              type='submit'
            >
              {pending ? 'Suppression…' : 'Retirer définitivement'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
};

const PackagingForm = ({
  baseUnitLabel,
  canCreatePackaging,
  canDeletePackaging,
  packagings,
  product,
}) => {
  const labelInputRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [labelValue, setLabelValue] = useState('');
  const [quantityValue, setQuantityValue] = useState('');
  const addPackagingWithProductId = addProductPackaging.bind(null, product.id);
  const runPackagingAdd = async (previousState, formData) => {
    const nextState = await addPackagingWithProductId(previousState, formData);

    setLabelValue(nextState.values.label);
    setQuantityValue(nextState.values.quantity);
    setIsOpen(!nextState.message);

    return nextState;
  };
  const quantityUnitLabel = `${baseUnitLabel.toLocaleLowerCase('fr')}s`;
  const [state, formAction, pending] = useActionState(
    runPackagingAdd,
    INITIAL_STATE,
  );
  const preview = labelValue.trim() && quantityValue.trim()
    ? `1 ${labelValue.trim()} = ${quantityValue.trim()} ${quantityUnitLabel}`
    : 'La conversion s’affichera ici.';

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    labelInputRef.current?.focus();
  }, [isOpen, state.revision]);

  return (
    <section
      aria-labelledby='packaging-title'
      className='overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'
    >
      <div className='flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-6 py-5'>
        <div>
          <h2
            className='text-lg font-semibold text-slate-900'
            id='packaging-title'
          >
            Conditionnements supplémentaires
          </h2>
          <p className='mt-1 text-sm leading-6 text-slate-600'>
            Unités utilisées pour acheter, recevoir et compter ce produit.
          </p>
        </div>
        {canCreatePackaging && !isOpen && (
          <button
            aria-label='Ajouter un conditionnement'
            className='inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-blue-700 transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            onClick={() => setIsOpen(true)}
            title='Ajouter un conditionnement'
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
              <path d='M12 5v14' />
              <path d='M5 12h14' />
            </svg>
          </button>
        )}
      </div>

      {canCreatePackaging && isOpen && (
        <form
          action={formAction}
          className={`px-6 py-4 ${packagings.length > 0 ? 'border-b border-slate-100' : ''}`}
        >
          {state.errors.form && (
            <p
              className='mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'
              role='alert'
            >
              {state.errors.form}
            </p>
          )}

          <div className='flex flex-wrap items-start justify-between gap-4'>
            <div className='min-w-[220px] flex-1'>
              <label className='sr-only' htmlFor='packaging-label'>
                Libellé du conditionnement
              </label>
              <input
                aria-describedby={
                  state.errors.label
                    ? 'packaging-label-error packaging-preview'
                    : 'packaging-preview'
                }
                aria-invalid={Boolean(state.errors.label)}
                autoComplete='off'
                className='w-full max-w-sm rounded-lg border border-slate-300 bg-white px-3 py-2 text-[15px] font-semibold text-slate-900 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-600 aria-invalid:focus:ring-red-100'
                id='packaging-label'
                maxLength={100}
                name='label'
                onChange={(event) => setLabelValue(event.target.value)}
                placeholder='Ex. Pack de 6'
                ref={labelInputRef}
                required
                value={labelValue}
              />
              <p
                aria-live='polite'
                className='mt-1.5 text-[13px] text-slate-500'
                id='packaging-preview'
              >
                {preview}
              </p>
              {state.errors.label && (
                <p
                  className='mt-1.5 text-sm text-red-700'
                  id='packaging-label-error'
                >
                  {state.errors.label}
                </p>
              )}
            </div>

            <div className='flex flex-wrap items-start gap-3'>
              <div>
                <label className='sr-only' htmlFor='packaging-quantity'>
                  Quantité en {quantityUnitLabel}
                </label>
                <div className='flex rounded-lg shadow-sm'>
                  <input
                    aria-describedby={
                      state.errors.quantity
                        ? 'packaging-quantity-error packaging-preview'
                        : 'packaging-preview'
                    }
                    aria-invalid={Boolean(state.errors.quantity)}
                    className='w-24 rounded-l-lg border border-r-0 border-slate-300 bg-white px-3 py-2 text-right text-sm font-semibold text-slate-900 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-600 aria-invalid:focus:ring-red-100'
                    id='packaging-quantity'
                    inputMode='numeric'
                    max={1000000}
                    min={2}
                    name='quantity'
                    onChange={(event) => setQuantityValue(event.target.value)}
                    placeholder='6'
                    required
                    step={1}
                    type='number'
                    value={quantityValue}
                  />
                  <span className='inline-flex items-center rounded-r-lg border border-slate-300 bg-slate-50 px-3 text-[13px] font-semibold text-slate-700'>
                    {quantityUnitLabel}
                  </span>
                </div>
                {state.errors.quantity && (
                  <p
                    className='mt-1.5 text-sm text-red-700'
                    id='packaging-quantity-error'
                  >
                    {state.errors.quantity}
                  </p>
                )}
              </div>

              <button
                className='rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
                disabled={pending}
                type='submit'
              >
                {pending ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              <button
                className='rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
                disabled={pending}
                onClick={() => setIsOpen(false)}
                type='button'
              >
                Annuler
              </button>
            </div>
          </div>
        </form>
      )}

      {packagings.length > 0 ? (
        <ul>
          {packagings.map((packaging, index) => (
            <li
              className={`flex flex-wrap items-center justify-between gap-4 px-6 py-4 ${index > 0 ? 'border-t border-slate-100' : ''}`}
              key={packaging.id}
            >
              <div>
                <p className='text-[15px] font-semibold text-slate-900'>
                  {packaging.label}
                </p>
                <p className='mt-1 text-[13px] text-slate-500'>
                  1 {packaging.label.toLocaleLowerCase('fr')} ={' '}
                  {packaging.quantity} {quantityUnitLabel}
                </p>
              </div>
              <div className='flex flex-wrap items-center gap-4'>
                <span className='rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[13px] font-semibold text-slate-700'>
                  {packaging.quantity} {quantityUnitLabel}
                </span>
                {canDeletePackaging && (
                  <PackagingRemovalButton
                    packaging={packaging}
                    product={product}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : !isOpen ? (
        <div className='flex flex-col items-center px-6 py-8 text-center'>
          <p className='text-[15px] font-semibold text-slate-700'>
            Aucun conditionnement défini
          </p>
          <p className='mt-2 max-w-md text-sm leading-6 text-slate-500'>
            Aucun pack, carton ou autre conditionnement avec quantité de
            conversion n’est encore défini pour ce produit.
          </p>
        </div>
      ) : null}

      {state.message && !isOpen && (
        <p
          className='border-t border-emerald-100 bg-emerald-50 px-6 py-3.5 text-sm font-semibold text-emerald-700'
          role='status'
        >
          {state.message}
        </p>
      )}

    </section>
  );
};

export default PackagingForm;
