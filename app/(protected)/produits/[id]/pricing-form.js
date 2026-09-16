'use client';

import { useRef, useState } from 'react';

import { validateProductSalePrice } from '../../../../lib/product-pricing.js';
import ConfirmationDialog from '../../confirmation-dialog.js';
import EditableCard, { EditingButtons, useInlineSave } from '../../components/editable-card.js';
import styles from './product-detail.module.css';
import ProductIcon from './product-icon.js';
import { updateProductSalePrice } from './pricing-actions.js';

const formatAmount = (centimes) => new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 2 }).format(centimes / 100);

const PriceEditor = ({ currentPrice, currentPriceInCentimes, productId, packagingId, unitLabel, onCancel, onSuccess, onPending }) => {
  const inputId = packagingId ? `pack-sale-price-${packagingId}` : 'sale-price';
  const [price, setPrice] = useState(currentPrice);
  const [localError, setLocalError] = useState(null);
  const dialogRef = useRef(null);
  const submitRef = useRef(null);
  const inputRef = useRef(null);
  const dataRef = useRef(null);
  const { state, pending, formRef, save } = useInlineSave({
    action: updateProductSalePrice.bind(null, productId),
    initialState: { errors: {}, revision: 0, values: { price: currentPrice } },
    onSuccess, onPending,
    failureMessage: 'La modification du prix est momentanément indisponible.',
  });
  const validation = validateProductSalePrice(price);
  const proposed = validation.data?.amountInCentimes;
  const difference = Number.isSafeInteger(currentPriceInCentimes) && Number.isSafeInteger(proposed)
    ? proposed - currentPriceInCentimes : null;
  const error = localError ?? state.errors.price;
  return (
    <form className={styles.editForm} ref={formRef} onSubmit={(event) => {
      event.preventDefault();
      if (pending) return;
      if (validation.errors) {
        setLocalError(validation.errors.price);
        inputRef.current?.focus();
        return;
      }
      setLocalError(null);
      dataRef.current = new FormData(event.currentTarget);
      dialogRef.current?.showModal();
    }}>
      {state.errors.form && <p className='mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800' role='alert' tabIndex={-1}>{state.errors.form}</p>}
      {packagingId && <input name='packagingId' type='hidden' value={packagingId} />}
      <label className='block text-sm font-medium text-slate-700' htmlFor={inputId}>Nouveau prix TTC en DA / {unitLabel}</label>
      <div className={styles.priceInput}><input aria-describedby={error ? `${inputId}-error ${inputId}-helper` : `${inputId}-helper`} aria-invalid={Boolean(error)} autoComplete='off'
        className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xl font-semibold text-slate-900 focus:border-blue-600 focus:outline-blue-600 aria-invalid:border-red-500'
        disabled={pending} id={inputId} inputMode='decimal' name='price' ref={inputRef} required type='text' value={price}
        onChange={(event) => { setPrice(event.target.value); setLocalError(null); }} /><span>DA TTC</span></div>
      <p aria-live='polite' className={styles.preview} id={`${inputId}-helper`}>
        {Number.isSafeInteger(proposed)
          ? difference === null ? `Premier prix : ${formatAmount(proposed)} DA.`
            : difference === 0 ? 'Identique au prix actuel.'
              : `Écart : ${difference > 0 ? '+' : '−'}${formatAmount(Math.abs(difference))} DA par rapport au prix actuel (${formatAmount(currentPriceInCentimes)} DA).`
          : 'Saisissez un prix positif avec deux décimales maximum.'}
      </p>
      {error && <p className='mt-2 text-sm text-red-700' id={`${inputId}-error`}>{error}</p>}
      <div ref={submitRef}><EditingButtons pending={pending} onCancel={onCancel} /></div>
      <ConfirmationDialog confirmLabel='Confirmer le nouveau prix' confirmType='button' dialogRef={dialogRef}
        onClose={() => submitRef.current?.querySelector('[type="submit"]')?.focus()}
        onConfirm={() => {
          dialogRef.current?.close();
          if (dataRef.current) save(dataRef.current);
        }} pending={pending} title='Confirmer le changement de prix ?'>
        <p>{Number.isSafeInteger(currentPriceInCentimes) ? `Prix actuel : ${formatAmount(currentPriceInCentimes)} DA.` : 'Aucun prix actuel.'} Nouveau prix : {Number.isSafeInteger(proposed) ? formatAmount(proposed) : '—'} DA TTC / {unitLabel}.</p>
        <p>Ce changement sera conservé dans l’historique.</p>
      </ConfirmationDialog>
    </form>
  );
};

const PricingForm = ({ baseUnitLabel, canUpdatePrice, currentPrice, currentPriceInCentimes, initiallyOpen, lastChange, productId, packagingId, description, title = 'Prix de vente TTC', priceHint = 'Par unité de base · chaque changement est historisé.' }) => {
  const unitLabel = baseUnitLabel.toLocaleLowerCase('fr');
  return (
    <EditableCard title={title} description={description} titleIcon={<ProductIcon name='price' />} className={styles.priceCurrent} canEdit={canUpdatePrice} initiallyOpen={initiallyOpen}
      formComponent={PriceEditor} formProps={{ currentPrice, currentPriceInCentimes, productId, packagingId, unitLabel }}>
      <div className={styles.priceMain}>
        <p className={styles.eyebrow}>Prix de vente actuel</p>
        {Number.isSafeInteger(currentPriceInCentimes) ? <p className={styles.priceValue}><strong>{formatAmount(currentPriceInCentimes)}</strong><span>DA TTC / {unitLabel}</span></p>
          : <p className={styles.emptyValue}>À renseigner</p>}
        <p className={styles.priceHint}>{priceHint}</p>
      </div>
      <div className={styles.sourceBox}><ProductIcon name='clock' /><div className='min-w-0 flex-1'>
        <p>Dernier changement</p><small>{lastChange ? `${lastChange.date} · ${lastChange.author}` : 'Aucun changement renseigné'}</small>
      </div></div>
    </EditableCard>
  );
};

export default PricingForm;
