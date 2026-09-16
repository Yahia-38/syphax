'use client';

import { useCallback, useEffect, useRef } from 'react';
import ConfirmationDialog from '../../confirmation-dialog.js';
import { useInlineSave } from '../../components/editable-card.js';
import { useEditingSession } from '../../components/editing-session.js';
import { releaseTourProduct } from './actions.js';

const INITIAL_STATE = { errors: {}, message: null, replayed: false, revision: 0 };

const TourReservationReleaseButton = ({ productCode, productDesignation, quantity, reservationId, tourId, unit, tourReference, delivererName }) => {
  const session = useEditingSession();
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const unregisterRef = useRef(null);
  const register = session?.register;
  const onPending = useCallback((value) => {
    if (value) unregisterRef.current = register?.({ pending: true, dirty: false, discard: () => {} });
    else { unregisterRef.current?.(); unregisterRef.current = null; }
  }, [register]);
  useEffect(() => () => unregisterRef.current?.(), []);
  const onSuccess = useCallback(() => triggerRef.current?.focus(), []);
  const { state, pending, save, formRef } = useInlineSave({
    action: releaseTourProduct.bind(null, tourId, reservationId), initialState: INITIAL_STATE,
    onPending, onSuccess, failureMessage: 'La libération est momentanément indisponible. Vérifiez les réservations avant de confirmer à nouveau.',
  });
  return (
    <div className='mt-4 sm:mt-0 sm:text-right' ref={formRef}>
      <button className='rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50'
        disabled={pending} ref={triggerRef} type='button' onClick={() => {
          const open = () => dialogRef.current?.showModal();
          if (session) session.request(open); else open();
        }}>{pending ? 'Libération…' : 'Libérer la réservation'}</button>
      <ConfirmationDialog confirmLabel='Libérer la réservation' confirmType='button' dialogRef={dialogRef}
        onClose={() => triggerRef.current?.focus()} onConfirm={() => { dialogRef.current?.close(); save(new FormData()); }}
        pending={pending} pendingLabel='Libération…' title='Libérer cette réservation ?' tone='red'>
        <p>Tournée <strong>{tourReference ?? tourId}</strong>{delivererName ? ` · ${delivererName}` : ''}.</p>
        <p><strong>{productCode} — {productDesignation}</strong> : {quantity} {unit} seront libérés et redeviendront disponibles.</p>
        <p>Cette action libère la réservation. Elle ne supprime aucune écriture et ne modifie pas le stock physique.</p>
      </ConfirmationDialog>
      {state.errors.form && <p className='mt-2 max-w-sm text-sm text-red-700' role='alert' tabIndex={-1}>{state.errors.form}</p>}
      {state.message && <p className='mt-2 max-w-sm text-sm text-emerald-700' role='status'>{state.message}</p>}
    </div>
  );
};
export default TourReservationReleaseButton;
