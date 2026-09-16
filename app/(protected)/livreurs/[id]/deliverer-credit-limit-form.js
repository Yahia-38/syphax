'use client';

import { useRef, useState } from 'react';

import { formatReceptionMoney, parseReceptionAmountInCentimes } from '../../../../lib/receptions.js';
import ConfirmationDialog from '../../confirmation-dialog.js';
import EditableCard, { EditingButtons, useInlineSave } from '../../components/editable-card.js';
import { updateDelivererCreditLimit } from './actions.js';
import styles from './deliverer-detail.module.css';

const formatAmountInput = (value) => Number.isSafeInteger(value) && value >= 0
  ? `${Math.floor(value / 100)}${value % 100 ? `.${String(value % 100).padStart(2, '0')}` : ''}` : '';
const formatLimit = (value) => Number.isSafeInteger(value) ? formatReceptionMoney(value) : 'Non configurée';
const formatDate = (value) => value ? new Intl.DateTimeFormat('fr-DZ', {
  dateStyle: 'long', timeStyle: 'short', hourCycle: 'h23', timeZone: 'Africa/Algiers',
}).format(new Date(value)) : 'Date indisponible';

const CreditLimitEditor = ({ creditLimit, delivererId, onCancel, onSuccess, onPending }) => {
  const [amount, setAmount] = useState(formatAmountInput(creditLimit.amountInCentimes));
  // This baseline is deliberately stable across server revalidation. A conflict
  // requires an explicit reread and another confirmation before any retry.
  const [baseline, setBaseline] = useState(creditLimit);
  const [reviewedRevision, setReviewedRevision] = useState(0);
  const dialogRef = useRef(null);
  const { state, pending, formRef, save } = useInlineSave({
    action: updateDelivererCreditLimit.bind(null, delivererId),
    initialState: { errors: {}, revision: 0, values: { amount } },
    onSuccess, onPending,
    failureMessage: 'La modification de la limite est momentanément indisponible.',
  });
  const stale = state.stale && reviewedRevision !== state.revision;
  const proposed = parseReceptionAmountInCentimes(amount);
  return (
    <form className={styles.editForm} ref={formRef} aria-busy={pending} onSubmit={(event) => {
      event.preventDefault();
      if (!pending && !stale) dialogRef.current?.showModal();
    }}>
      {state.errors.form && <p className={styles.error} role='alert' tabIndex={-1}>{state.errors.form}</p>}
      {stale && <div className={styles.attention} role='alert'>
        <p>Un autre utilisateur a modifié la limite. Votre proposition est conservée. Relisez la valeur actuelle, puis confirmez à nouveau.</p>
        <button className={styles.secondary} type='button' onClick={() => {
          setBaseline(creditLimit);
          setReviewedRevision(state.revision);
          formRef.current?.querySelector('[name="creditLimitAmount"]')?.focus();
        }}>Relire la limite actuelle</button>
      </div>}
      <fieldset disabled={pending || stale}>
        <input name='creditLimitExpectedVersion' type='hidden' value={baseline.version} />
        <div className={styles.formField}>
          <label htmlFor='deliverer-credit-limit'>Limite en dinars algériens</label>
          <div className={styles.priceInput}>
            <input id='deliverer-credit-limit' name='creditLimitAmount' inputMode='decimal' type='number'
              min='0' max='90071992547409.91' step='0.01' required value={amount}
              onChange={(event) => setAmount(event.target.value)} aria-invalid={Boolean(state.errors.amount)}
              aria-describedby={`deliverer-credit-limit-help${state.errors.amount ? ' deliverer-credit-limit-error' : ''}`} />
            <span>DA</span>
          </div>
          <small>Valeur relue : {formatLimit(baseline.amountInCentimes)}.</small>
          <small id='deliverer-credit-limit-help'>Zéro est une limite configurée à 0 DA. Le seuil reste indicatif et ne bloque pas les opérations.</small>
          {state.errors.amount && <p className={styles.fieldError} id='deliverer-credit-limit-error'>{state.errors.amount}</p>}
        </div>
      </fieldset>
      <EditingButtons pending={pending} onCancel={onCancel} />
      <ConfirmationDialog confirmType='button' confirmLabel='Confirmer la limite' dialogRef={dialogRef}
        confirmDisabled={stale || proposed === null} pending={pending} pendingLabel='Enregistrement…'
        onClose={() => formRef.current?.querySelector('button[type="submit"]')?.focus()} title='Confirmer la limite de crédit ?' onConfirm={() => {
          if (pending || stale) return;
          const data = new FormData(formRef.current);
          dialogRef.current?.close();
          save(data);
        }}>
        <p>La limite passera de <strong>{formatLimit(baseline.amountInCentimes)}</strong> à <strong>{proposed === null ? 'Montant invalide' : formatLimit(proposed)}</strong>.</p>
        <p>Un dépassement alerte sans bloquer les opérations. Toute modification effective est historisée.</p>
      </ConfirmationDialog>
    </form>
  );
};

const DelivererCreditLimitForm = ({ canUpdate, creditLimit, delivererId }) => (
  <EditableCard title='Limite configurée' description='Seuil d’alerte appliqué à l’engagement du livreur.'
    canEdit={canUpdate} editLabel={creditLimit.configured ? 'Modifier' : 'Configurer'}
    formComponent={CreditLimitEditor} formProps={{ creditLimit, delivererId }}>
    <div className={styles.creditValue}>
      <p className={styles.eyebrow}>Seuil indicatif</p>
      <p className={styles.bigNumber}>{formatLimit(creditLimit.amountInCentimes)}</p>
      {creditLimit.configured && <small>Modifiée le {formatDate(creditLimit.updatedAt)} · {creditLimit.updatedBy ?? 'Compte indisponible'}</small>}
    </div>
    <p className={styles.footnote}>Un dépassement déclenche une alerte. Il ne bloque pas les opérations.</p>
  </EditableCard>
);

export default DelivererCreditLimitForm;
