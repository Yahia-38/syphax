'use client';

import { useState } from 'react';

import EditableCard, { EditingButtons, useInlineSave } from '../../components/editable-card.js';
import styles from './product-detail.module.css';
import ProductIcon from './product-icon.js';
import ProductFields from '../product-fields.js';
import { updateProduct } from './product-actions.js';

const IdentificationForm = ({ baseUnits, product, onCancel, onSuccess, onPending }) => {
  const [values, setValues] = useState({ code: product.code, designation: product.designation, baseUnit: product.baseUnit });
  const { state, pending, formRef, save } = useInlineSave({
    action: updateProduct.bind(null, product.id),
    initialState: { errors: {}, revision: 0, values },
    onSuccess, onPending,
    failureMessage: 'La modification du produit est momentanément indisponible.',
  });
  return (
    <form className={`${styles.editForm} space-y-4`} ref={formRef} onSubmit={(event) => {
      event.preventDefault();
      save(new FormData(event.currentTarget));
    }}>
      {state.errors.form && <p className='rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800' role='alert' tabIndex={-1}>{state.errors.form}</p>}
      <fieldset className='space-y-4 disabled:opacity-70' disabled={pending}>
        <ProductFields baseUnits={baseUnits} state={{ ...state, values }} onChange={(name, value) => setValues((previous) => ({ ...previous, [name]: value }))} />
        <p className='text-xs leading-5 text-slate-500'>Le changement d’unité reste soumis aux références et à l’historique d’utilisation du produit.</p>
      </fieldset>
      <EditingButtons pending={pending} onCancel={onCancel} />
    </form>
  );
};

const ProductEditForm = ({ baseUnits, baseUnitLabel, canUpdateProduct, initiallyOpen, product }) => (
  <EditableCard title='Identification' titleIcon={<ProductIcon name='identification' />} canEdit={canUpdateProduct} initiallyOpen={initiallyOpen}
    formComponent={IdentificationForm} formProps={{ baseUnits, product }}>
    <dl className={styles.fields}>
      <div className={styles.fieldRow}><dt>Désignation</dt><dd>{product.designation}</dd></div>
      <div className={styles.fieldRow}><dt>Code produit</dt><dd><code className={styles.code}>{product.code}</code></dd></div>
      <div className={styles.fieldRow}><dt>Unité de base</dt><dd><span className={styles.unitTag}>{baseUnitLabel}</span></dd></div>
    </dl>
    <p className={styles.footnote}>L’unité de base sert à compter le stock et à exprimer les conversions.</p>
  </EditableCard>
);

export default ProductEditForm;
