'use client';

import { startTransition, useActionState, useEffect, useId, useRef, useState } from 'react';

import { useEditingSession } from '../../components/editing-session.js';

import { createTour } from './actions.js';

const INITIAL_STATE = {
  errors: {},
  revision: 0,
  values: {},
};

const TourCreateButton = ({
  creationKey,
  deliverer,
  initialPlannedDate,
  returnHref,
}) => {
  const session = useEditingSession();
  const lockedRef = useRef(false);
  const unregisterRef = useRef(null);
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const titleId = useId();
  const [activeCreationKey] = useState(creationKey);
  const createTourWithContext = createTour.bind(
    null,
    deliverer.id,
    returnHref,
  );
  const [state, formAction, pending] = useActionState(
    async (previousState, formData) => {
      try {
        return await createTourWithContext(previousState, formData);
      } catch (error) {
        if (error?.digest?.startsWith('NEXT_REDIRECT;')) throw error;
        return {
          errors: { form: 'La création de la tournée est momentanément indisponible. Réessayez.' },
          revision: previousState.revision + 1,
          values: { plannedDate: formData.get('plannedDate'), creationKey: formData.get('creationKey') },
        };
      }
    },
    INITIAL_STATE,
  );

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
        className='rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
        onClick={open}
        ref={triggerRef}
        type='button'
      >
        Nouvelle tournée
      </button>

      <dialog
        aria-labelledby={titleId}
        className='m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-0 text-left shadow-xl backdrop:bg-slate-950/40'
        onClose={() => triggerRef.current?.focus()}
        ref={dialogRef}
      >
        <form className='p-6' onSubmit={protectSubmission} aria-busy={pending}>
          <input name='creationKey' type='hidden' value={activeCreationKey} />
          <p className='text-xs font-semibold uppercase tracking-wide text-blue-700'>
            Nouvelle tournée
          </p>
          <h2 className='mt-2 text-xl font-semibold text-slate-900' id={titleId}>
            {deliverer.name}
          </h2>
          <p className='mt-1 font-mono text-sm font-semibold text-slate-600'>
            {deliverer.code}
          </p>
          <p className='mt-3 text-sm leading-6 text-slate-600'>
            La tournée sera créée vide, avec le statut « En préparation ».
          </p>

          <div className='mt-5'>
            <label
              className='block text-sm font-medium text-slate-700'
              htmlFor='tour-planned-date'
            >
              Date prévue
            </label>
            <input
              aria-describedby={state.errors.plannedDate
                ? 'tour-planned-date-error'
                : undefined}
              aria-invalid={Boolean(state.errors.plannedDate)}
              className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
              disabled={pending}
              defaultValue={state.values.plannedDate ?? initialPlannedDate}
              id='tour-planned-date'
              name='plannedDate'
              required
              type='date'
            />
            {state.errors.plannedDate && (
              <p
                className='mt-2 text-sm text-red-700'
                id='tour-planned-date-error'
              >
                {state.errors.plannedDate}
              </p>
            )}
          </div>

          {(state.errors.delivererId || state.errors.form) && (
            <p
              className='mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'
              role='alert'
              tabIndex={-1}
            >
              {state.errors.delivererId ?? state.errors.form}
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
              className='rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600'
              disabled={pending}
              type='submit'
            >
              {pending ? 'Création…' : 'Créer la tournée'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
};

export default TourCreateButton;
