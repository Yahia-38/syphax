'use client';

import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import CashPaymentForm from '../cash-payment-form.js';
import { recordTourPayment } from '../cash-payment-actions.js';
import { useCashNotice } from './cash-form-context.js';
import styles from './cash.module.css';

const INITIAL_STATE = { errors: {}, values: { amount: '', note: '' }, revision: 0, succeeded: false };

const CashTourPayment = ({ cashRegister, deliverer, tour, confirmationKey, onCancel, onSuccess, onPending }) => {
  const [initialKey] = useState(confirmationKey);
  const lockedRef = useRef(false);
  const requestRef = useRef(null);
  const [frozenProjection, setFrozenProjection] = useState(null);
  const [initialCashRegister] = useState(cashRegister);
  const formRef = useRef(null);
  const showNotice = useCashNotice();
  const [state, dispatch, pending] = useActionState(async (previous, formData) => {
    try {
      return await recordTourPayment(previous, formData);
    } catch {
      return { ...previous, revision: previous.revision + 1, uncertain: true, errors: { form: 'La réponse n’a pas été reçue. Le versement peut avoir été enregistré.' } };
    }
  }, INITIAL_STATE);
  const uncertain = Boolean(state.uncertain);
  useEffect(() => {
    if (pending || !state.revision) return;
    lockedRef.current = false;
    onPending(uncertain);
    if (state.succeeded) {
      showNotice(state.message);
      onSuccess(state.message);
    } else {
      requestAnimationFrame(() => (formRef.current?.querySelector('[aria-invalid="true"]') ?? formRef.current?.querySelector('[role="alert"]'))?.focus());
    }
  }, [state, pending, uncertain, onSuccess, onPending, showNotice]);
  const projection = (pending || uncertain) && frozenProjection ? frozenProjection : { tour: cashRegister ? tour : { ...tour, remainingDueInCentimes: null }, cashRegister: cashRegister ?? initialCashRegister };
  return <div ref={formRef} className={styles.inlineForm}>
    <p className={styles.target}>Encaissement ciblé · <strong>{deliverer.code} — {deliverer.name}</strong> · {tour.reference}</p>
    <CashPaymentForm cashRegister={projection.cashRegister} deliverer={deliverer}
      confirmationKey={state.confirmationKey ?? initialKey} formAction={dispatch}
      idPrefix={`cash-tour-${tour.id}`} pending={pending || uncertain}
      remainingDueInCentimes={projection.tour.remainingDueInCentimes}
      state={state} tourId={tour.id} tourReference={tour.reference} onCancel={onCancel}
      onConfirmedSubmit={(formData) => {
        if (lockedRef.current || uncertain) return false;
        lockedRef.current = true;
        requestRef.current = formData;
        setFrozenProjection({ tour, cashRegister });
        onPending(true);
        return true;
      }} />
    {state.stale && <p className={styles.warning} role='alert' tabIndex={-1}>Relisez le reste actualisé. La saisie est conservée ; une nouvelle confirmation est nécessaire.</p>}
    {uncertain && <aside className={styles.warning} role='alert' tabIndex={-1}>
      <p>Résultat à vérifier. Le montant, la note et la demande sont figés jusqu’à la résolution.</p>
      <button type='button' disabled={pending} onClick={() => {
        if (lockedRef.current) return;
        lockedRef.current = true;
        onPending(true);
        startTransition(() => dispatch(requestRef.current));
      }}>{pending ? 'Vérification…' : 'Vérifier / Réessayer'}</button>
    </aside>}
  </div>;
};

export default CashTourPayment;
