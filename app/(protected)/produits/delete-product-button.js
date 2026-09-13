'use client';

import { useActionState, useId, useRef } from 'react';

import { deleteProduct } from './delete-actions.js';

const INITIAL_STATE = { error: null };

const DeleteProductButton = ({ compact = false, product }) => {
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const titleId = useId();
  const deleteProductWithId = deleteProduct.bind(null, product.id);
  const [state, formAction, pending] = useActionState(
    deleteProductWithId,
    INITIAL_STATE,
  );

  return (
    <>
      <button
        className={
          compact
            ? 'rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:border-red-300 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700'
            : 'rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 transition hover:border-red-300 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700'
        }
        onClick={() => dialogRef.current?.showModal()}
        ref={triggerRef}
        type='button'
      >
        Supprimer
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
            Supprimer ce produit ?
          </h2>
          <p className='mt-2 text-sm leading-6 text-slate-600'>
            Le produit <strong>{product.code}</strong> — {product.designation}
            {' '}sera supprimé définitivement. Cette action est irréversible.
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
              {pending ? 'Suppression…' : 'Supprimer définitivement'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
};

export default DeleteProductButton;
