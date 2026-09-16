'use client';

import { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import EditableCard from '../../components/editable-card.js';
import { TourOperationContext } from './tour-operation-context.js';
import TourCountingSheet from './tour-counting-sheet.js';
import TourExpensePreview from './tour-expense-preview.js';
import TourPaymentPreview from './tour-payment-preview.js';
import TourProductForm from './tour-product-form.js';
import TourLoadingConfirmation from './tour-loading-confirmation.js';
import TourCancellationConfirmation from './tour-cancellation-confirmation.js';
import TourClosingConfirmation from './tour-closing-confirmation.js';
import styles from './tour-detail.module.css';

const FORMS = {
  counting: TourCountingSheet, expenses: TourExpensePreview, payment: TourPaymentPreview,
  product: TourProductForm, loading: TourLoadingConfirmation,
  cancellation: TourCancellationConfirmation, closing: TourClosingConfirmation,
};

const ICON_PATHS = {
  counting: 'M8 4H5v17h14V4h-3 M8 3h8v4H8z M8 12l2 2 5-5 M8 18h8',
  expenses: 'M5 3h14v18l-3-2-4 2-4-2-3 2z M9 8h6 M9 12h6',
  payment: 'M3 6h18v12H3z M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6',
  closing: 'M5 12l4 4L19 6',
  cancellation: 'M6 6l12 12M6 18L18 6',
  product: 'M12 5v14M5 12h14',
  loading: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
};

const OperationForm = ({ kind, operationProps, onCancel, onSuccess, onPending, onDraftChange }) => {
  const Form = FORMS[kind];
  const formId = useId();
  const router = useRouter();
  const [lastProjection, setLastProjection] = useState(operationProps);
  if ((operationProps.preview && operationProps.preview !== lastProjection.preview)
    || (operationProps.sheet && operationProps.sheet !== lastProjection.sheet)) {
    setLastProjection(operationProps);
  }
  // A successful transition can remove the server's action preview before the
  // action result closes the editor. Retain its last projection and draft then.
  const currentProps = { ...operationProps,
    preview: operationProps.preview ?? lastProjection.preview,
    sheet: operationProps.sheet ?? lastProjection.sheet };
  const needsCancelRow = !['counting', 'expenses', 'payment'].includes(kind)
    || Boolean(currentProps.preview?.errors?.form || currentProps.sheet?.errors?.form)
    || (kind === 'payment' && (!currentProps.preview?.cashRegister
      || !Number.isSafeInteger(currentProps.preview?.remainingDueInCentimes)
      || currentProps.preview.remainingDueInCentimes <= 0));

  const [error, setError] = useState(false);
  const [stableKeys] = useState(() => ({ initialConfirmationKey: operationProps.initialConfirmationKey, initialAdditionKey: operationProps.initialAdditionKey }));
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const reportPending = (value) => {
    locked.current = value;
    setPending(value);
    onPending(value);
  };
  return (
    <TourOperationContext.Provider value={{ onSuccess, onPending: reportPending, onCancel, onDraftChange, formId, onResult: (state) => setError(Boolean(state.errors?.form)) }}>
      <div className={styles.form} id={formId} aria-busy={pending}
        onSubmitCapture={(event) => { if (locked.current) event.preventDefault(); }}
        onSubmit={(event) => { if (!event.defaultPrevented) reportPending(true); }}>
        <fieldset disabled={pending}>
          <Form {...currentProps} {...stableKeys} embedded />
        </fieldset>
        {error && <div className={styles.read}><p>Votre saisie est conservée. Relisez les données actuelles avant une nouvelle confirmation.</p><button className='mt-2 rounded-lg border border-slate-300 px-3 py-2' type='button' disabled={pending} onClick={() => router.refresh()}>Relire les données actuelles</button></div>}
        {needsCancelRow && <div className={styles.cancelRow}>
          <small>{pending ? 'Enregistrement en cours…' : 'Saisie non enregistrée'}</small>
          <button disabled={pending} onClick={onCancel} type='button'>Annuler la saisie</button>
        </div>}
      </div>
    </TourOperationContext.Provider>
  );
};

const TourOperationCard = ({ id, kind, title, summary, canEdit, editLabel, operationProps, children }) => (
  <div id={id} className={styles.operation} data-operation={kind}>
    <EditableCard title={title} editingLabel='Saisie en cours' className={styles.card}
      titleIcon={<span className={styles.operationIcon} aria-hidden='true'><svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' strokeLinejoin='round'><path d={ICON_PATHS[kind]} /></svg></span>}
      description={summary} canEdit={canEdit} editLabel={editLabel} trackDraft
      formComponent={OperationForm} formProps={{ kind, operationProps }}>
      {children}
    </EditableCard>
  </div>
);

export default TourOperationCard;
