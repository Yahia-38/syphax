'use client';

import { useState } from 'react';

import EditableCard, { EditingButtons, useInlineSave } from '../../components/editable-card.js';
import { updateDeliverer } from './actions.js';
import styles from './deliverer-detail.module.css';

const IdentificationForm = ({ deliverer, returnHref, onCancel, onSuccess, onPending }) => {
  const [values, setValues] = useState({ name: deliverer.name, code: deliverer.code, phone: deliverer.phone ?? '' });
  const { state, pending, formRef, save } = useInlineSave({
    action: updateDeliverer.bind(null, deliverer.id, returnHref),
    initialState: { errors: {}, revision: 0, values },
    onSuccess, onPending,
    failureMessage: 'La modification du livreur est momentanément indisponible.',
  });
  return (
    <form className={styles.editForm} ref={formRef} aria-busy={pending} onSubmit={(event) => {
      event.preventDefault();
      save(new FormData(event.currentTarget));
    }}>
      {state.errors.form && <p className={styles.error} role='alert' tabIndex={-1}>{state.errors.form}</p>}
      <fieldset disabled={pending}>
        {[
          ['name', 'Nom du livreur', 150, 'text', 'name'],
          ['code', 'Code livreur', 50, 'text', 'off'],
          ['phone', 'Téléphone · facultatif', 30, 'tel', 'tel'],
        ].map(([name, label, maxLength, type, autoComplete]) => (
          <div className={styles.formField} key={name}>
            <label htmlFor={`deliverer-${name}`}>{label}</label>
            <input id={`deliverer-${name}`} name={name} type={type} autoComplete={autoComplete} maxLength={maxLength}
              required={name !== 'phone'} value={values[name]} aria-invalid={Boolean(state.errors[name])}
              aria-describedby={state.errors[name] ? `deliverer-${name}-error` : name === 'code' ? 'deliverer-code-help' : undefined}
              onChange={(event) => setValues((previous) => ({ ...previous, [name]: event.target.value }))} />
            {name === 'code' && <small id='deliverer-code-help'>Code unique, sans espace intérieur.</small>}
            {state.errors[name] && <p className={styles.fieldError} id={`deliverer-${name}-error`}>{state.errors[name]}</p>}
          </div>
        ))}
      </fieldset>
      <EditingButtons pending={pending} onCancel={onCancel} />
    </form>
  );
};

const DelivererEditForm = ({ deliverer, canUpdate, initiallyOpen, returnHref }) => (
  <EditableCard title='Identification' canEdit={canUpdate} initiallyOpen={initiallyOpen}
    formComponent={IdentificationForm} formProps={{ deliverer, returnHref }}>
    <dl className={styles.fields}>
      <div><dt>Nom</dt><dd>{deliverer.name}</dd></div>
      <div><dt>Code livreur</dt><dd><code>{deliverer.code}</code></dd></div>
      <div><dt>Téléphone</dt><dd>{deliverer.phone || 'Non renseigné'}</dd></div>
    </dl>
  </EditableCard>
);

export default DelivererEditForm;
