'use client';

import { useId, useRef } from 'react';
import dialogStyles from './confirmation-dialog.module.css';

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
  appearance = 'default',
  children,
  confirmDisabled = false,
  confirmLabel,
  cancelLabel = 'Annuler',
  cancelAutoFocus = false,
  confirmType = 'submit',
  dialogRef,
  onClose,
  onConfirm,
  pending = false,
  pendingLabel = 'Confirmation…',
  title,
  tone = 'blue',
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const styles = TONE_STYLES[tone] ?? TONE_STYLES.blue;
  const compact = appearance === 'compact';

  return (
    <dialog
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={compact ? dialogStyles.dialog : 'm-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-slate-200 bg-white p-0 text-left shadow-2xl backdrop:bg-slate-950/50'}
      onCancel={(event) => {
        if (pending) {
          event.preventDefault();
        }
      }}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(event.currentTarget.querySelectorAll(
          'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )).filter((element) => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      ref={dialogRef}
    >
      <div className={compact ? dialogStyles.content : 'p-5 sm:p-6'}>
        {!compact && <div className={`flex h-11 w-11 items-center justify-center rounded-full text-xl font-semibold ${styles.icon}`}>
          ?
        </div>}
        <h2 className={compact ? dialogStyles.title : 'mt-4 text-xl font-semibold text-slate-950'} id={titleId}>
          {title}
        </h2>
        <div className={compact ? dialogStyles.description : 'mt-3 space-y-3 text-sm leading-6 text-slate-600'} id={descriptionId}>
          {children}
        </div>
        <div className={compact ? dialogStyles.actions : 'mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end'}>
          <button
            autoFocus={cancelAutoFocus}
            className={compact ? dialogStyles.button : 'min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 motion-safe:transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60'}
            disabled={pending}
            onClick={() => dialogRef.current?.close()}
            type='button'
          >
            {cancelLabel}
          </button>
          <button
            className={compact ? `${dialogStyles.button} ${dialogStyles.danger}` : `min-h-11 rounded-lg px-4 py-2.5 text-sm font-semibold text-white motion-safe:transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${styles.confirm}`}
            disabled={pending || confirmDisabled}
            onClick={onConfirm}
            type={confirmType}
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
};

export default ConfirmationDialog;
