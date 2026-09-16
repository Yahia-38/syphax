'use client';

import { createContext, useActionState, useContext, useEffect, useRef } from 'react';
import styles from './tour-detail.module.css';

export const TourOperationContext = createContext(null);

export const TourFormActions = ({ children, pending }) => {
  const operation = useContext(TourOperationContext);
  if (!operation) return children;
  return <div className={styles.formActions}>
    <small>{pending ? 'Enregistrement en cours…' : 'Saisie non enregistrée'}</small>
    <button disabled={pending} onClick={operation.onCancel} type='button'>Annuler la saisie</button>
    {children}
  </div>;
};

// Keep the existing action contract; only report its confirmed lifecycle to the card.
export const useTourActionState = (action, initialState) => {
  const operation = useContext(TourOperationContext);
  const [state, dispatch, pending] = useActionState(async (previous, data) => {
    try {
      return await action(previous, data);
    } catch {
      return { ...previous, message: null, succeeded: false, revision: previous.revision + 1,
        errors: { form: 'L’enregistrement est momentanément indisponible. Votre saisie est conservée ; vérifiez la situation avant de confirmer à nouveau.' } };
    }
  }, initialState);
  const handledRevision = useRef(initialState.revision);
  useEffect(() => {
    if (!operation || pending || state.revision === handledRevision.current) return;
    handledRevision.current = state.revision;
    operation.onPending(false);
    operation.onResult(state);
    if (state.message) operation.onSuccess(state.message);
    else requestAnimationFrame(() => {
      const form = document.getElementById(operation.formId);
      (form?.querySelector('[aria-invalid="true"]') ?? form?.querySelector('[role="alert"]'))?.focus();
    });
  }, [state, pending, operation]);
  return [state, dispatch, pending];
};

export const useTourDraft = (values) => {
  const operation = useContext(TourOperationContext);
  const serialized = JSON.stringify(values);
  useEffect(() => { operation?.onDraftChange(serialized); }, [serialized, operation]);
};
