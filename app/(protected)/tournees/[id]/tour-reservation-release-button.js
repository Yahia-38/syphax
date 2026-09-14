'use client';

import { useActionState } from 'react';

import ConfirmationDialog, {
  useFormConfirmation,
} from '../../confirmation-dialog.js';
import { releaseTourProduct } from './actions.js';

const INITIAL_STATE = {
  errors: {},
  message: null,
  replayed: false,
  revision: 0,
};

const TourReservationReleaseButton = ({
  productCode,
  productDesignation,
  quantity,
  reservationId,
  tourId,
  unit,
}) => {
  const releaseReservation = releaseTourProduct.bind(
    null,
    tourId,
    reservationId,
  );
  const [state, formAction, pending] = useActionState(
    releaseReservation,
    INITIAL_STATE,
  );
  const {
    confirmSubmission,
    dialogRef,
    requestConfirmation,
    restoreTriggerFocus,
  } = useFormConfirmation();

  return (
    <div className='mt-4 sm:mt-0 sm:text-right'>
      <form
        action={formAction}
        onSubmit={requestConfirmation}
      >
        <button
          className='rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50'
          disabled={pending}
          type='submit'
        >
          {pending ? 'Retrait…' : 'Retirer'}
        </button>

        <ConfirmationDialog
          confirmLabel='Retirer et libérer le stock'
          dialogRef={dialogRef}
          onClose={restoreTriggerFocus}
          onConfirm={confirmSubmission}
          pending={pending}
          pendingLabel='Retrait…'
          title='Retirer ce produit de la tournée ?'
          tone='red'
        >
          <p>
            Le produit <strong className='text-slate-950'>{productCode} — {productDesignation}</strong>
            {' '}sera retiré de la tournée.
          </p>
          <p>
            <strong className='text-slate-950'>{quantity} {unit}</strong>
            {' '}seront libérés et redeviendront disponibles.
          </p>
        </ConfirmationDialog>
      </form>
      {state.errors.form && (
        <p className='mt-2 max-w-sm text-sm text-red-700' role='alert'>
          {state.errors.form}
        </p>
      )}
      {state.message && (
        <p className='mt-2 max-w-sm text-sm text-emerald-700' role='status'>
          {state.message}
        </p>
      )}
    </div>
  );
};

export default TourReservationReleaseButton;
