'use client';

import { useId, useRef } from 'react';

const TONE_STYLES = Object.freeze({
  amber: {
    confirm: 'bg-amber-700 hover:bg-amber-800 focus-visible:outline-amber-700',
    icon: 'bg-amber-100 text-amber-800',
  },
  blue: {
    confirm: 'bg-blue-700 hover:bg-blue-800 focus-visible:outline-blue-700',
    icon: 'bg-blue-100 text-blue-700',
  },
  red: {
    confirm: 'bg-red-700 hover:bg-red-800 focus-visible:outline-red-700',
    icon: 'bg-red-100 text-red-700',
  },
  slate: {
    confirm: 'bg-slate-800 hover:bg-slate-900 focus-visible:outline-slate-800',
    icon: 'bg-slate-200 text-slate-800',
  },
  violet: {
    confirm: 'bg-violet-700 hover:bg-violet-800 focus-visible:outline-violet-700',
    icon: 'bg-violet-100 text-violet-700',
  },
});

export const useFormConfirmation = () => {
  const confirmationGrantedRef = useRef(false);
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);

  const requestConfirmation = (event) => {
    if (confirmationGrantedRef.current) {
      confirmationGrantedRef.current = false;
      return;
    }

    event.preventDefault();

    if (!event.nativeEvent.submitter) {
      return;
    }

    triggerRef.current = event.nativeEvent.submitter;
    dialogRef.current?.showModal();
  };

  const confirmSubmission = () => {
    confirmationGrantedRef.current = true;
    dialogRef.current?.close();
  };

  const restoreTriggerFocus = () => triggerRef.current?.focus();

  return {
    confirmSubmission,
    dialogRef,
    requestConfirmation,
    restoreTriggerFocus,
  };
};

const ConfirmationDialog = ({
  children,
  confirmLabel,
  dialogRef,
  onClose,
  onConfirm,
  pending = false,
  pendingLabel = 'Confirmation…',
  title,
  tone = 'blue',
}) => {
  const titleId = useId();
  const styles = TONE_STYLES[tone] ?? TONE_STYLES.blue;

  return (
    <dialog
      aria-labelledby={titleId}
      className='m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-slate-200 bg-white p-0 text-left shadow-2xl backdrop:bg-slate-950/50'
      onCancel={(event) => {
        if (pending) {
          event.preventDefault();
        }
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      <div className='p-5 sm:p-6'>
        <div className={`flex h-11 w-11 items-center justify-center rounded-full text-xl font-semibold ${styles.icon}`}>
          ?
        </div>
        <h2 className='mt-4 text-xl font-semibold text-slate-950' id={titleId}>
          {title}
        </h2>
        <div className='mt-3 space-y-3 text-sm leading-6 text-slate-600'>
          {children}
        </div>
        <div className='mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end'>
          <button
            className='rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
            disabled={pending}
            onClick={() => dialogRef.current?.close()}
            type='button'
          >
            Annuler
          </button>
          <button
            className={`rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${styles.confirm}`}
            disabled={pending}
            onClick={onConfirm}
            type='submit'
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
};

export default ConfirmationDialog;
