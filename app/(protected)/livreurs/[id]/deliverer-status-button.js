'use client';

import { startTransition, useActionState, useEffect, useId, useRef } from 'react';

import { useEditingSession } from '../../components/editing-session.js';

import { deactivateDeliverer, reactivateDeliverer } from './actions.js';

const INITIAL_STATE = { error: null, revision: 0 };

const DelivererStatusButton = ({ deliverer, returnHref }) => {
  const session = useEditingSession();
  const lockedRef = useRef(false);
  const unregisterRef = useRef(null);
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const titleId = useId();
  const statusAction = deliverer.active
    ? deactivateDeliverer
    : reactivateDeliverer;
  const statusActionWithContext = statusAction.bind(
    null,
    deliverer.id,
    returnHref,
  );
  const [state, formAction, pending] = useActionState(
    async (previousState) => {
      try {
        return await statusActionWithContext(previousState);
      } catch (error) {
        if (error?.digest?.startsWith('NEXT_REDIRECT;')) throw error;
        return { error: 'Le changement de statut est momentanément indisponible. Réessayez.', revision: previousState.revision + 1 };
      }
    },
    INITIAL_STATE,
  );
  const actionLabel = deliverer.active ? 'Désactiver' : 'Réactiver';

  useEffect(() => {
    if (!pending && state.revision > 0) {
      lockedRef.current = false;
      unregisterRef.current?.();
      unregisterRef.current = null;
      requestAnimationFrame(() => dialogRef.current?.querySelector('[aria-invalid="true"], [role="alert"]')?.focus());
    }
  }, [pending, state.revision]);
  useEffect(() => () => unregisterRef.current?.(), []);
  useEffect(() => {
    const dialog = dialogRef.current;
    const guardCancel = (event) => { if (lockedRef.current) event.preventDefault(); };
    // Some browsers emit a non-cancelable dialog cancel event for Escape.
    const guardEscape = (event) => {
      if (dialog?.open && lockedRef.current && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    dialog?.addEventListener('cancel', guardCancel);
    document.addEventListener('keydown', guardEscape, true);
    return () => {
      dialog?.removeEventListener('cancel', guardCancel);
      document.removeEventListener('keydown', guardEscape, true);
    };
  }, []);
  const open = () => {
    const proceed = () => dialogRef.current?.showModal();
    if (session) session.request(proceed); else proceed();
  };
  const protectSubmission = (event) => {
    event.preventDefault();
    if (lockedRef.current) return;
    const data = new FormData(event.currentTarget);
    lockedRef.current = true;
    unregisterRef.current = session?.register({ dirty: false, pending: true, discard: () => {} });
    startTransition(() => formAction(data));
  };

  return (
    <>
      <button
        className={deliverer.active
          ? 'rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800 transition hover:border-amber-400 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700'
          : 'rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800 transition hover:border-emerald-400 hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700'}
        onClick={open}
        ref={triggerRef}
        type='button'
      >
        {actionLabel}
      </button>

      <dialog
        aria-labelledby={titleId}
        className='m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-0 text-left shadow-xl backdrop:bg-slate-950/40'
        onClose={() => triggerRef.current?.focus()}
        ref={dialogRef}
      >
        <form className='p-6' onSubmit={protectSubmission} aria-busy={pending}>
          <div className={deliverer.active
            ? 'flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-xl text-amber-800'
            : 'flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-xl text-emerald-800'}
          >
            !
          </div>
          <h2 className='mt-4 text-xl font-semibold text-slate-900' id={titleId}>
            {actionLabel} ce livreur ?
          </h2>
          <p className='mt-2 text-sm leading-6 text-slate-600'>
            Le livreur <strong>{deliverer.code}</strong> — {deliverer.name} sera
            {' '}{deliverer.active ? 'désactivé' : 'réactivé'}. Sa fiche et son
            historique seront conservés.
          </p>

          {state.error && (
            <p
              className='mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'
              role='alert'
              tabIndex={-1}
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
              className={deliverer.active
                ? 'rounded-lg bg-amber-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:cursor-not-allowed disabled:opacity-60'
                : 'rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-60'}
              disabled={pending}
              type='submit'
            >
              {pending ? 'Enregistrement…' : `Confirmer — ${actionLabel}`}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
};

export default DelivererStatusButton;
