'use client';

import { useActionState } from 'react';

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
  const confirmation = `Retirer « ${productCode} — ${productDesignation} » et libérer ${quantity} ${unit} ?`;

  return (
    <div className='mt-4 sm:mt-0 sm:text-right'>
      <form
        action={formAction}
        onSubmit={(event) => {
          if (!globalThis.confirm(confirmation)) {
            event.preventDefault();
          }
        }}
      >
        <button
          className='rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50'
          disabled={pending}
          type='submit'
        >
          {pending ? 'Retrait…' : 'Retirer'}
        </button>
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
