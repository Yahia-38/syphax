'use client';

import { startTransition, useActionState, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { useEditingSession } from './editing-session.js';
import styles from './editable-card.module.css';

export const EditingButtons = ({ pending, onCancel, submitLabel = 'Enregistrer', pendingLabel = 'Enregistrement…', note = 'Modifications non enregistrées', submitIcon }) => (
  <div className={styles.actions}>
    <small>{pending ? pendingLabel : note}</small>
    <button disabled={pending} onClick={onCancel} type='button'>Annuler</button>
    <button disabled={pending} type='submit'>{!pending && submitIcon}{pending ? pendingLabel : submitLabel}</button>
  </div>
);

// Submission lifecycle only: the caller owns fields, validation and the action contract.
export const useInlineSave = ({ action, initialState, onSuccess, onPending, failureMessage }) => {
  const lockedRef = useRef(false);
  const formRef = useRef(null);
  const [state, dispatch, pending] = useActionState(async (previous, formData) => {
    try {
      return await action(previous, formData);
    } catch {
      return { ...previous, message: null, revision: previous.revision + 1, errors: { form: failureMessage } };
    }
  }, initialState);

  const save = (formData) => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    onPending(true);
    startTransition(() => dispatch(formData));
  };

  useEffect(() => {
    if (pending || state.revision === initialState.revision) return;
    lockedRef.current = false;
    onPending(false);
    if (state.message) {
      onSuccess(state.message, state);
      return;
    }
    requestAnimationFrame(() => {
      const invalid = formRef.current?.querySelector('[aria-invalid="true"]');
      const target = invalid?.querySelector('input, select, textarea') ?? invalid
        ?? formRef.current?.querySelector('[role="alert"]');
      target?.focus();
    });
  }, [state, pending, initialState.revision, onPending, onSuccess]);

  return { state, pending, formRef, save };
};

const serializeFields = (element) => JSON.stringify(
  Array.from(element?.querySelector('form')?.querySelectorAll('input[name]:not([type="hidden"]), select[name], textarea[name]') ?? [])
    .map((field) => [field.name, ['checkbox', 'radio'].includes(field.type) ? [field.checked, field.value] : field.value]),
);

const EditableCard = ({ title, description, canEdit, initiallyOpen = false, editLabel = 'Modifier', keepReadContent = false, children, formComponent: Form, formProps = {}, onSaved, titleIcon, creation = false, editingLabel = 'Modification en cours', className = '', trackDraft = false }) => {
  const titleId = useId();
  const [editing, setEditing] = useState(initiallyOpen && canEdit);
  const [message, setMessage] = useState(null);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const baselineRef = useRef('');
  const activeRef = useRef(null);
  const draftBaselineRef = useRef(undefined);
  const session = useEditingSession();
  const register = session?.register;
  const discard = useCallback((restoreFocus = true) => {
    setEditing(false);
    setMessage(null);
    activeRef.current = null;
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useLayoutEffect(() => {
    if (!editing) return;
    baselineRef.current = serializeFields(containerRef.current);
    draftBaselineRef.current = undefined;
    (containerRef.current?.querySelector('[data-autofocus]') ?? containerRef.current?.querySelector('form input:not([type="hidden"]), form select, form textarea'))?.focus();
    const active = { dirty: false, pending: false, discard: () => discard(false) };
    activeRef.current = active;
    return register?.(active);
  }, [editing, register, discard]);

  const onDraftChange = useCallback((value) => {
    if (draftBaselineRef.current === undefined) draftBaselineRef.current = value;
    if (activeRef.current) activeRef.current.dirty = value !== draftBaselineRef.current;
  }, []);

  const onPending = useCallback((pending) => {
    if (activeRef.current) activeRef.current.pending = pending;
  }, []);
  const onSuccess = useCallback((successMessage) => {
    discard();
    setMessage(successMessage);
    onSaved?.();
  }, [discard, onSaved]);

  return (
    <section aria-labelledby={titleId} className={`${styles.card} ${editing ? styles.editing : ''} ${creation ? styles.creation : ''} ${className}`} ref={containerRef}
      onChangeCapture={() => {
        if (!trackDraft && activeRef.current) activeRef.current.dirty = serializeFields(containerRef.current) !== baselineRef.current;
      }}>
      <div className={styles.header}>
        <div className={styles.context}>
          <div className={styles.title}>{titleIcon}<h2 id={titleId}>{title}</h2></div>
          {description && <p className={styles.description}>{description}</p>}
        </div>
        {editing && <span className={styles.label}>{editingLabel}</span>}
        {canEdit && !editing && <button className={styles.edit} ref={triggerRef} type='button' onClick={() => {
          const open = () => { setMessage(null); setEditing(true); };
          if (session) session.request(open); else open();
        }}><svg aria-hidden='true' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'><path d={creation ? 'M12 5v14M5 12h14' : 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'} /></svg>{editLabel}</button>}
      </div>
      {editing && <Form {...formProps} onCancel={() => session ? session.request(discard) : discard()} onDraftChange={onDraftChange} onSuccess={onSuccess} onPending={onPending} />}
      {(!editing || keepReadContent) && children}
      {message && <p className={styles.success} role='status'>{message}</p>}
    </section>
  );
};

export default EditableCard;
