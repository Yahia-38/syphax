'use client';

import { useState } from 'react';

import EditableCard, { EditingButtons, useInlineSave } from '../../components/editable-card.js';
import { getSalePackagings } from '../../../../lib/product-packaging.js';
import { updateDefaultSaleUnit } from './packaging-actions.js';
import styles from './product-detail.module.css';
import ProductIcon from './product-icon.js';

const formatQuantity = (quantity) => new Intl.NumberFormat('fr-DZ').format(quantity);

const DefaultSaleUnitEditor = ({ baseUnitOptionLabel, defaultSaleUnit, productId, quantityUnitLabel, salePackagings, onCancel, onSuccess, onPending }) => {
  const [value, setValue] = useState(defaultSaleUnit ?? '');
  const { state, pending, formRef, save } = useInlineSave({
    action: updateDefaultSaleUnit.bind(null, productId),
    initialState: { errors: {}, message: null, revision: 0, values: { defaultSaleUnit: value } },
    onSuccess, onPending,
    failureMessage: 'La modification du conditionnement par défaut est momentanément indisponible.',
  });
  return (
    <form className={styles.editForm} ref={formRef} onSubmit={(event) => { event.preventDefault(); save(new FormData(event.currentTarget)); }}>
      {state.errors.form && <p className='mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800' role='alert' tabIndex={-1}>{state.errors.form}</p>}
      <fieldset disabled={pending}>
        <label htmlFor='default-sale-unit'>Conditionnement par défaut</label>
        <select aria-invalid={Boolean(state.errors.defaultSaleUnit)} aria-describedby={state.errors.defaultSaleUnit ? 'default-sale-unit-error default-sale-unit-help' : 'default-sale-unit-help'}
          id='default-sale-unit' name='defaultSaleUnit' value={value} onChange={(event) => setValue(event.target.value)}>
          <option value=''>{baseUnitOptionLabel}</option>
          {salePackagings.map((packaging) => <option key={packaging.id} value={packaging.id}>{packaging.label} ({formatQuantity(packaging.quantity)} {quantityUnitLabel})</option>)}
        </select>
        {state.errors.defaultSaleUnit && <p className='mt-2 text-sm text-red-700' id='default-sale-unit-error'>{state.errors.defaultSaleUnit}</p>}
        <p className='text-slate-500' id='default-sale-unit-help'>Seuls les conditionnements activés pour la vente peuvent être choisis.</p>
      </fieldset>
      <EditingButtons pending={pending} onCancel={onCancel} />
    </form>
  );
};

const DefaultSaleUnitForm = ({ baseUnitLabel, canUpdateProduct, defaultSaleUnit, packagings, productId }) => {
  const unit = baseUnitLabel.toLocaleLowerCase('fr');
  const baseUnitOptionLabel = `Unité (${unit})`;
  const quantityUnitLabel = `${unit}s`;
  const salePackagings = getSalePackagings(packagings);
  const current = salePackagings.find(({ id }) => id === defaultSaleUnit);
  return (
    <EditableCard title='Conditionnement par défaut' titleIcon={<ProductIcon name='box' />} description='L’unité proposée en premier lors de la vente de ce produit.'
      canEdit={canUpdateProduct} formComponent={DefaultSaleUnitEditor}
      formProps={{ baseUnitOptionLabel, defaultSaleUnit: current?.id ?? null, productId, quantityUnitLabel, salePackagings }}>
      <dl className={styles.fields}>
        <div className={styles.fieldRow}><dt>Vente par défaut</dt>
          <dd>{current ? <>{current.label} <span className={styles.subnote}>({formatQuantity(current.quantity)} {quantityUnitLabel})</span></> : <span className={styles.unitTag}>{baseUnitOptionLabel}</span>}</dd>
        </div>
      </dl>
      {!salePackagings.length && <p className={styles.footnote}>Aucun conditionnement n’est activé pour la vente : la vente se fait à l’unité.</p>}
    </EditableCard>
  );
};

export default DefaultSaleUnitForm;
