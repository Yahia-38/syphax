'use client';

import { useRef, useState } from 'react';

import { formatObjectiveChangedAt, formatObjectiveMonth, isObjectiveMonth } from '../../../../lib/deliverer-objective-calculations.js';
import { formatReceptionMoney, parseReceptionAmountInCentimes } from '../../../../lib/receptions.js';
import ConfirmationDialog from '../../confirmation-dialog.js';
import EditableCard, { EditingButtons, useInlineSave } from '../../components/editable-card.js';
import { updateDelivererObjective } from './actions.js';
import styles from './deliverer-detail.module.css';

const formatAmountInput = (value) => Number.isSafeInteger(value)
  ? `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}` : '';
const amountLabel = (entry) => entry ? formatReceptionMoney(entry.amountInCentimes) : 'Objectif non défini';

const ObjectiveEditor = ({ objectives, delivererId, onCancel, onSuccess, onPending }) => {
  const [amount, setAmount] = useState(formatAmountInput((objectives.current ?? objectives.next)?.amountInCentimes));
  const [effectiveMonth, setEffectiveMonth] = useState(objectives.current ? objectives.currentMonth : objectives.next?.effectiveMonth ?? objectives.currentMonth);
  // Keep the reviewed version stable until the user explicitly rereads a conflict.
  const [baseline, setBaseline] = useState(objectives);
  const [reviewedRevision, setReviewedRevision] = useState(0);
  const dialogRef = useRef(null);
  const { state, pending, formRef, save } = useInlineSave({
    action: updateDelivererObjective.bind(null, delivererId),
    initialState: { errors: {}, revision: 0 },
    onSuccess, onPending,
    failureMessage: 'La modification de l’objectif est momentanément indisponible.',
  });
  const stale = Boolean(state.stale && reviewedRevision !== state.revision);
  const proposed = parseReceptionAmountInCentimes(amount);
  const valid = proposed !== null && proposed > 0 && isObjectiveMonth(effectiveMonth)
    && effectiveMonth >= objectives.currentMonth;
  return (
    <form ref={formRef} className={styles.editForm} aria-busy={pending} onSubmit={(event) => {
      event.preventDefault();
      if (!pending && !stale && valid) dialogRef.current?.showModal();
    }}>
      {state.errors.form && <p className={styles.error} role='alert' tabIndex={-1}>{state.errors.form}</p>}
      {stale && <div className={styles.attention} role='alert'>
        <p>L’objectif a changé. Votre proposition est conservée. Objectif actuel : {amountLabel(objectives.current)}.{objectives.next && ` Prochain changement : ${amountLabel(objectives.next)} à partir de ${formatObjectiveMonth(objectives.next.effectiveMonth)}.`}</p>
        <button type='button' className={styles.secondary} onClick={() => {
          setBaseline(objectives);
          setReviewedRevision(state.revision);
          formRef.current?.querySelector('[name="objectiveAmount"]')?.focus();
        }}>Relire l’objectif actuel</button>
      </div>}
      <fieldset disabled={pending || stale}>
        <input type='hidden' name='objectiveExpectedVersion' value={baseline.version} />
        <div className={styles.formField}>
          <label htmlFor='deliverer-objective-amount'>Objectif mensuel en dinars algériens</label>
          <div className={styles.priceInput}>
            <input id='deliverer-objective-amount' name='objectiveAmount' type='number' inputMode='decimal'
              min='0.01' max='90071992547409.91' step='0.01' required value={amount}
              onChange={(event) => setAmount(event.target.value)} aria-invalid={Boolean(state.errors.amount)}
              aria-describedby={state.errors.amount ? 'deliverer-objective-amount-error' : undefined} />
            <span>DA</span>
          </div>
          {state.errors.amount && <p id='deliverer-objective-amount-error' className={styles.fieldError}>{state.errors.amount}</p>}
        </div>
        <div className={styles.formField}>
          <label htmlFor='deliverer-objective-month'>À partir du mois de</label>
          <input id='deliverer-objective-month' name='objectiveEffectiveMonth' type='month' required
            min={objectives.currentMonth} max='9999-12' value={effectiveMonth} onChange={(event) => setEffectiveMonth(event.target.value)}
            aria-invalid={Boolean(state.errors.effectiveMonth)}
            aria-describedby={`deliverer-objective-help${state.errors.effectiveMonth ? ' deliverer-objective-month-error' : ''}`} />
          <small id='deliverer-objective-help'>Le montant se répète chaque mois jusqu’au prochain changement programmé. Les mois passés sont conservés.</small>
          {state.errors.effectiveMonth && <p id='deliverer-objective-month-error' className={styles.fieldError}>{state.errors.effectiveMonth}</p>}
        </div>
      </fieldset>
      <EditingButtons pending={pending} onCancel={onCancel} />
      <ConfirmationDialog dialogRef={dialogRef} title='Confirmer l’objectif mensuel ?' confirmType='button'
        confirmLabel='Confirmer l’objectif' confirmDisabled={!valid || stale} pending={pending} pendingLabel='Enregistrement…'
        onClose={() => formRef.current?.querySelector('button[type="submit"]')?.focus()} onConfirm={() => {
          if (pending || stale || !valid) return;
          const data = new FormData(formRef.current);
          dialogRef.current?.close();
          save(data);
        }}>
        <p>L’objectif sera de <strong>{valid ? formatReceptionMoney(proposed) : 'Montant invalide'} par mois</strong> à partir de <strong>{formatObjectiveMonth(effectiveMonth)}</strong>.</p>
        <p>Les mois précédents et les changements déjà programmés pour les mois suivants sont conservés. Cette modification sera enregistrée avec sa date et son auteur.</p>
      </ConfirmationDialog>
    </form>
  );
};

const DelivererObjectiveForm = ({ canUpdate, objectives, delivererId }) => (
  <EditableCard title='Objectif mensuel' description='Chiffre d’affaires à réaliser aux prix de vente.'
    canEdit={canUpdate} editLabel={objectives.version ? 'Modifier' : 'Définir l’objectif'}
    formComponent={ObjectiveEditor} formProps={{ objectives, delivererId }}>
    <div className={styles.creditValue}>
      <p className={styles.eyebrow}>{formatObjectiveMonth(objectives.currentMonth)}</p>
      <p className={styles.bigNumber}>{amountLabel(objectives.current)}</p>
      {objectives.current && <>
        <small>Applicable depuis {formatObjectiveMonth(objectives.current.effectiveMonth)}.</small>
        <small>Enregistré le {formatObjectiveChangedAt(objectives.current.changedAt)} · {objectives.current.changedBy}</small>
      </>}
      {objectives.next && <div className={styles.attention}>
        <strong>Prochain objectif : {amountLabel(objectives.next)} par mois</strong>
        <p>À partir de {formatObjectiveMonth(objectives.next.effectiveMonth)}.</p>
        <small>Enregistré le {formatObjectiveChangedAt(objectives.next.changedAt)} · {objectives.next.changedBy}</small>
      </div>}
    </div>
    <p className={styles.footnote}>L’objectif se répète chaque mois jusqu’au prochain changement programmé.</p>
  </EditableCard>
);

export default DelivererObjectiveForm;
