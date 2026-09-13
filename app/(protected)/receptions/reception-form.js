'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';

import {
  calculateReceptionLine,
  changeReceptionLineProduct,
  createEmptyReceptionLine,
  formatReceptionMoney,
  formatReceptionUnitCost,
  validateReceptionDraft,
  validateReceptionLine,
} from '../../../lib/receptions.js';
import { createReception } from './actions.js';

const INPUT_CLASS = 'mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500';

const INITIAL_RECEPTION_STATE = {
  errors: {},
  message: null,
  receptionId: null,
  replayed: false,
  revision: 0,
};

const getProduct = (products, productId) =>
  products.find(({ id }) => id === productId) ?? null;

const getUnitLabel = (baseUnits, product) => {
  const unit = baseUnits.find(({ code }) => code === product?.baseUnit);

  return unit?.label ?? 'Unité de base';
};

const ReceptionLineForm = ({
  baseUnits,
  calculation,
  errors,
  index,
  line,
  onCancel,
  onChange,
  onProductChange,
  onValidate,
  products,
}) => {
  const product = getProduct(products, line.productId);
  const unitLabel = getUnitLabel(baseUnits, product);
  const hasPackagings = Boolean(product?.packagings.length);
  const lowerUnitLabel = unitLabel.toLocaleLowerCase('fr');

  return (
    <fieldset className='rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5'>
      <legend className='sr-only'>Ligne {index + 1}</legend>
      <div>
        <p className='text-sm font-semibold text-slate-900'>
          Saisie de la ligne {index + 1}
        </p>
        <p className='mt-1 text-xs text-slate-500'>
          La ligne deviendra un récapitulatif après validation.
        </p>
      </div>

      <div className='mt-5 grid gap-5 lg:grid-cols-2'>
        <div className='lg:col-span-2'>
          <label
            className='block text-sm font-medium text-slate-700'
            htmlFor={`${line.id}-product`}
          >
            Produit
          </label>
          <select
            aria-describedby={errors.product ? `${line.id}-product-error` : undefined}
            aria-invalid={Boolean(errors.product)}
            className={INPUT_CLASS}
            id={`${line.id}-product`}
            onChange={(event) => onProductChange(event.target.value)}
            required
            value={line.productId}
          >
            <option value=''>Sélectionnez un produit</option>
            {products.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.code} — {candidate.designation}
              </option>
            ))}
          </select>
          {errors.product && (
            <p className='mt-2 text-sm text-red-700' id={`${line.id}-product-error`}>
              {errors.product}
            </p>
          )}
        </div>

        <div className='lg:col-span-2'>
          <p className='text-sm font-medium text-slate-700'>Mode de saisie</p>
          <div className='mt-2 flex flex-col gap-2 sm:flex-row sm:gap-6'>
            <label className='inline-flex items-center gap-2 text-sm text-slate-700'>
              <input
                checked={line.quantityMode === 'DIRECT'}
                name={`${line.id}-quantity-mode`}
                onChange={() => onChange({
                  directQuantity: '',
                  packagingCount: '',
                  packagingId: '',
                  quantityMode: 'DIRECT',
                })}
                type='radio'
              />
              Quantité directe
            </label>
            <label className='inline-flex items-center gap-2 text-sm text-slate-700'>
              <input
                checked={line.quantityMode === 'PACKAGING'}
                disabled={!product || !hasPackagings}
                name={`${line.id}-quantity-mode`}
                onChange={() => onChange({
                  directQuantity: '',
                  packagingCount: '',
                  packagingId: '',
                  quantityMode: 'PACKAGING',
                })}
                type='radio'
              />
              Nombre de conditionnements
            </label>
          </div>
          {product && !hasPackagings && (
            <p className='mt-2 text-xs text-amber-700'>
              Ce produit ne possède aucun conditionnement ; utilisez la saisie directe.
            </p>
          )}
        </div>

        {line.quantityMode === 'DIRECT' ? (
          <div>
            <label
              className='block text-sm font-medium text-slate-700'
              htmlFor={`${line.id}-direct-quantity`}
            >
              Quantité en {lowerUnitLabel}
            </label>
            <input
              aria-describedby={errors.directQuantity
                ? `${line.id}-direct-quantity-error`
                : undefined}
              aria-invalid={Boolean(errors.directQuantity)}
              className={INPUT_CLASS}
              disabled={!product}
              id={`${line.id}-direct-quantity`}
              inputMode='numeric'
              min='1'
              onChange={(event) => onChange({ directQuantity: event.target.value })}
              placeholder='Ex. 60'
              step='1'
              type='number'
              value={line.directQuantity}
            />
            {errors.directQuantity && (
              <p
                className='mt-2 text-sm text-red-700'
                id={`${line.id}-direct-quantity-error`}
              >
                {errors.directQuantity}
              </p>
            )}
          </div>
        ) : (
          <>
            <div>
              <label
                className='block text-sm font-medium text-slate-700'
                htmlFor={`${line.id}-packaging`}
              >
                Conditionnement
              </label>
              <select
                aria-describedby={errors.packaging
                  ? `${line.id}-packaging-error`
                  : undefined}
                aria-invalid={Boolean(errors.packaging)}
                className={INPUT_CLASS}
                id={`${line.id}-packaging`}
                onChange={(event) => onChange({ packagingId: event.target.value })}
                value={line.packagingId}
              >
                <option value=''>Sélectionnez un conditionnement</option>
                {(product?.packagings ?? []).map((packaging) => (
                  <option key={packaging.id} value={packaging.id}>
                    {packaging.label} — {packaging.quantity} {lowerUnitLabel}
                  </option>
                ))}
              </select>
              {errors.packaging && (
                <p className='mt-2 text-sm text-red-700' id={`${line.id}-packaging-error`}>
                  {errors.packaging}
                </p>
              )}
            </div>
            <div>
              <label
                className='block text-sm font-medium text-slate-700'
                htmlFor={`${line.id}-packaging-count`}
              >
                Nombre de conditionnements
              </label>
              <input
                aria-describedby={errors.packagingCount
                  ? `${line.id}-packaging-count-error`
                  : undefined}
                aria-invalid={Boolean(errors.packagingCount)}
                className={INPUT_CLASS}
                id={`${line.id}-packaging-count`}
                inputMode='numeric'
                min='1'
                onChange={(event) => onChange({ packagingCount: event.target.value })}
                placeholder='Ex. 10'
                step='1'
                type='number'
                value={line.packagingCount}
              />
              {errors.packagingCount && (
                <p
                  className='mt-2 text-sm text-red-700'
                  id={`${line.id}-packaging-count-error`}
                >
                  {errors.packagingCount}
                </p>
              )}
            </div>
          </>
        )}

        <div className='lg:col-span-2'>
          <label
            className='block text-sm font-medium text-slate-700'
            htmlFor={`${line.id}-amount`}
          >
            Montant TTC de la ligne
          </label>
          <div className='relative mt-2'>
            <input
              aria-describedby={errors.amount
                ? `${line.id}-amount-error ${line.id}-amount-help`
                : `${line.id}-amount-help`}
              aria-invalid={Boolean(errors.amount)}
              className={`${INPUT_CLASS} mt-0 pr-12`}
              id={`${line.id}-amount`}
              inputMode='decimal'
              min='0'
              onChange={(event) => onChange({ amount: event.target.value })}
              placeholder='Ex. 120,00'
              required
              step='0.01'
              type='number'
              value={line.amount}
            />
            <span className='pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-medium text-slate-500'>
              DA
            </span>
          </div>
          <p className='mt-2 text-xs leading-5 text-slate-500' id={`${line.id}-amount-help`}>
            Montant total TTC du produit sur cette ligne, avant calcul du coût unitaire.
          </p>
          {errors.amount && (
            <p className='mt-2 text-sm text-red-700' id={`${line.id}-amount-error`}>
              {errors.amount}
            </p>
          )}
        </div>

        <div className='rounded-lg border border-blue-100 bg-blue-50 p-4'>
          <p className='text-xs font-semibold uppercase tracking-wide text-blue-700'>
            Quantité totale reçue
          </p>
          <p className='mt-2 text-xl font-bold text-blue-950'>
            {calculation.quantityInBaseUnits ?? '—'} {lowerUnitLabel}
          </p>
          <p className='mt-1 text-xs leading-5 text-blue-800'>
            {line.quantityMode === 'PACKAGING'
              ? 'Calculée depuis le conditionnement et non modifiable séparément.'
              : 'Saisie directement dans l’unité de base du produit.'}
          </p>
        </div>

        <div className='rounded-lg border border-emerald-100 bg-emerald-50 p-4'>
          <p className='text-xs font-semibold uppercase tracking-wide text-emerald-700'>
            Coût unitaire TTC
          </p>
          <p className='mt-2 text-xl font-bold text-emerald-950'>
            {formatReceptionUnitCost(calculation)}
            {calculation.amountInCentimes !== null
              && calculation.quantityInBaseUnits !== null && (
                <span className='ml-1 text-sm font-medium text-emerald-800'>
                  / {lowerUnitLabel}
                </span>
            )}
          </p>
          <p className='mt-1 text-xs leading-5 text-emerald-800'>
            Calculé depuis le montant TTC et la quantité totale en unité de base.
          </p>
        </div>

        <div className='flex justify-end gap-3 lg:col-span-2'>
          <button
            className='rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            onClick={onCancel}
            type='button'
          >
            Annuler
          </button>
          <button
            className='rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            onClick={onValidate}
            type='button'
          >
            Valider la ligne
          </button>
        </div>
      </div>
    </fieldset>
  );
};

const ReceptionLineSummary = ({
  baseUnits,
  index,
  line,
  onEdit,
  onRemove,
  products,
}) => {
  const product = getProduct(products, line.productId);
  const calculation = calculateReceptionLine(line, product);
  const unitLabel = getUnitLabel(baseUnits, product).toLocaleLowerCase('fr');
  const packaging = line.quantityMode === 'PACKAGING'
    ? product?.packagings.find(({ id }) => id === line.packagingId)
    : null;

  return (
    <article className='rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5'>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
        <div className='min-w-0'>
          <p className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
            Ligne {index + 1}
          </p>
          <h3 className='mt-1 break-words text-base font-semibold text-slate-900'>
            {product?.code} — {product?.designation}
          </h3>
          <p className='mt-2 text-sm text-slate-600'>
            {line.quantityMode === 'PACKAGING' && packaging
              ? `${line.packagingCount} × ${packaging.label} de ${packaging.quantity} ${unitLabel}`
              : 'Quantité saisie directement'}
          </p>
          <p className='mt-1 text-lg font-bold text-blue-900'>
            {calculation.quantityInBaseUnits} {unitLabel} au total
          </p>
          <dl className='mt-4 grid gap-3 sm:grid-cols-2'>
            <div className='rounded-lg bg-white px-3 py-2'>
              <dt className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
                Montant TTC
              </dt>
              <dd className='mt-1 font-semibold text-slate-900'>
                {formatReceptionMoney(calculation.amountInCentimes)}
              </dd>
            </div>
            <div className='rounded-lg bg-white px-3 py-2'>
              <dt className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
                Coût unitaire TTC
              </dt>
              <dd className='mt-1 font-semibold text-slate-900'>
                {formatReceptionUnitCost(calculation)} / {unitLabel}
              </dd>
            </div>
          </dl>
        </div>
        <div className='flex shrink-0 gap-2'>
          <button
            className='rounded-lg px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            onClick={onEdit}
            type='button'
          >
            Modifier
          </button>
          <button
            className='rounded-lg px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700'
            onClick={onRemove}
            type='button'
          >
            Retirer
          </button>
        </div>
      </div>
    </article>
  );
};

const ReceptionDraftForm = ({
  baseUnits,
  initialDate,
  onSuccess,
  products,
  submissionKey,
  suppliers,
}) => {
  const nextLineId = useRef(1);
  const [state, formAction, pending] = useActionState(
    createReception,
    INITIAL_RECEPTION_STATE,
  );
  const [editingLineId, setEditingLineId] = useState(null);
  const [lineDraft, setLineDraft] = useState(null);
  const [lineErrors, setLineErrors] = useState({});
  const [lines, setLines] = useState([]);
  const [receptionError, setReceptionError] = useState(null);
  const lineDraftProduct = lineDraft
    ? getProduct(products, lineDraft.productId)
    : null;
  const lineDraftCalculation = useMemo(
    () => lineDraft
      ? calculateReceptionLine(lineDraft, lineDraftProduct)
      : null,
    [lineDraft, lineDraftProduct],
  );

  useEffect(() => {
    if (state.message) {
      onSuccess(state.message);
    }
  }, [onSuccess, state.message]);

  const updateLineDraft = (changes) => {
    setLineDraft((currentLine) => ({ ...currentLine, ...changes }));
    setLineErrors({});
    setReceptionError(null);
  };

  const changeDraftProduct = (productId) => {
    setLineDraft((currentLine) =>
      changeReceptionLineProduct(currentLine, productId));
    setLineErrors({});
    setReceptionError(null);
  };

  const addLine = () => {
    const id = `reception-line-${nextLineId.current}`;

    nextLineId.current += 1;
    setEditingLineId(null);
    setLineDraft(createEmptyReceptionLine(id));
    setLineErrors({});
    setReceptionError(null);
  };

  const cancelLineDraft = () => {
    setEditingLineId(null);
    setLineDraft(null);
    setLineErrors({});
    setReceptionError(null);
  };

  const editLine = (line) => {
    setEditingLineId(line.id);
    setLineDraft({ ...line, productQuery: '' });
    setLineErrors({});
    setReceptionError(null);
  };

  const validateLineDraft = () => {
    const validation = validateReceptionLine(lineDraft, lineDraftProduct);

    if (validation.errors) {
      setLineErrors(validation.errors);
      return;
    }

    setLines((currentLines) => editingLineId
      ? currentLines.map((line) => line.id === editingLineId ? lineDraft : line)
      : [...currentLines, lineDraft]);
    cancelLineDraft();
  };

  const removeLine = (lineId) => {
    setLines((currentLines) => currentLines.filter(({ id }) => id !== lineId));
    setReceptionError(null);
  };

  const markReceptionDirty = () => {
    setReceptionError(null);
  };

  const validateReception = (event) => {
    const validation = validateReceptionDraft({
      hasLineDraft: Boolean(lineDraft),
      lineCount: lines.length,
    });

    if (validation.error) {
      event.preventDefault();
      setReceptionError(validation.error);
      return;
    }

    setReceptionError(null);
  };

  if (state.message) {
    return null;
  }

  return (
    <form
      action={formAction}
      className='mt-6 space-y-6'
      id='new-reception-form'
      onSubmit={validateReception}
    >
          <input
            name='lines'
            type='hidden'
            value={JSON.stringify(lines.map((line) => ({
              ...line,
              baseUnit: getProduct(products, line.productId)?.baseUnit ?? '',
            })))}
          />
          <input name='submissionKey' type='hidden' value={submissionKey} />
          <section
            aria-labelledby='reception-header-title'
            className='rounded-2xl border border-slate-200 bg-white shadow-sm'
          >
            <div className='border-b border-slate-200 p-5 sm:p-6'>
              <h2
                className='text-lg font-semibold text-slate-900'
                id='reception-header-title'
              >
                Nouvelle réception
              </h2>
              <p className='mt-1 text-sm leading-6 text-slate-600'>
                Renseignez le document fournisseur et préparez les quantités reçues.
              </p>
            </div>
            <div className='grid gap-5 p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-3'>
              <div>
                <label className='block text-sm font-medium text-slate-700' htmlFor='reception-supplier'>
                  Fournisseur actif
                </label>
                <select
                  aria-describedby={state.errors.supplierId
                    ? 'reception-supplier-error'
                    : undefined}
                  aria-invalid={Boolean(state.errors.supplierId)}
                  className={INPUT_CLASS}
                  id='reception-supplier'
                  name='supplierId'
                  onChange={markReceptionDirty}
                  required
                >
                  <option value=''>Sélectionnez un fournisseur</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
                {state.errors.supplierId && (
                  <p className='mt-2 text-sm text-red-700' id='reception-supplier-error'>
                    {state.errors.supplierId}
                  </p>
                )}
                {suppliers.length === 0 && (
                  <p className='mt-2 text-xs text-amber-700'>
                    Aucun fournisseur actif n’est disponible.
                  </p>
                )}
              </div>
              <div>
                <label className='block text-sm font-medium text-slate-700' htmlFor='reception-date'>
                  Date de réception
                </label>
                <input
                  aria-describedby={state.errors.receptionDate
                    ? 'reception-date-error'
                    : undefined}
                  aria-invalid={Boolean(state.errors.receptionDate)}
                  className={INPUT_CLASS}
                  defaultValue={initialDate}
                  id='reception-date'
                  name='receptionDate'
                  onChange={markReceptionDirty}
                  required
                  type='date'
                />
                {state.errors.receptionDate && (
                  <p className='mt-2 text-sm text-red-700' id='reception-date-error'>
                    {state.errors.receptionDate}
                  </p>
                )}
              </div>
              <div>
                <label className='block text-sm font-medium text-slate-700' htmlFor='supplier-reference'>
                  Référence du document fournisseur
                </label>
                <input
                  aria-describedby={state.errors.supplierReference
                    ? 'supplier-reference-error'
                    : undefined}
                  aria-invalid={Boolean(state.errors.supplierReference)}
                  className={INPUT_CLASS}
                  id='supplier-reference'
                  maxLength={100}
                  name='supplierReference'
                  onChange={markReceptionDirty}
                  placeholder='Ex. BL-2026-0042'
                  required
                  type='text'
                />
                {state.errors.supplierReference && (
                  <p className='mt-2 text-sm text-red-700' id='supplier-reference-error'>
                    {state.errors.supplierReference}
                  </p>
                )}
              </div>
            </div>

            <div className='flex flex-col gap-4 border-y border-slate-200 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6'>
              <div>
                <h2 className='text-lg font-semibold text-slate-900' id='reception-lines-title'>
                  Lignes de réception
                </h2>
                <p className='mt-1 text-sm leading-6 text-slate-600'>
                  Chaque quantité et chaque montant TTC restent attachés à leur produit et à leur unité de base.
                </p>
              </div>
              <button
                className='inline-flex w-fit items-center justify-center rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600'
                disabled={Boolean(lineDraft)}
                onClick={addLine}
                type='button'
              >
                {lineDraft ? 'Une ligne est en cours' : 'Ajouter une ligne'}
              </button>
            </div>
            <div className='space-y-5 p-5 sm:p-6'>
              {lines.map((line, index) => line.id !== editingLineId && (
                <ReceptionLineSummary
                  baseUnits={baseUnits}
                  index={index}
                  key={line.id}
                  line={line}
                  onEdit={() => editLine(line)}
                  onRemove={() => removeLine(line.id)}
                  products={products}
                />
              ))}
              {lineDraft && (
                <ReceptionLineForm
                  baseUnits={baseUnits}
                  calculation={lineDraftCalculation}
                  errors={lineErrors}
                  index={editingLineId
                    ? lines.findIndex(({ id }) => id === editingLineId)
                    : lines.length}
                  line={lineDraft}
                  onCancel={cancelLineDraft}
                  onChange={updateLineDraft}
                  onProductChange={changeDraftProduct}
                  onValidate={validateLineDraft}
                  products={products}
                />
              )}
              {lines.length === 0 && !lineDraft && (
                <div className='py-10 text-center'>
                  <h3 className='font-semibold text-slate-900'>
                    Aucune ligne ajoutée
                  </h3>
                  <p className='mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600'>
                    Cliquez sur « Ajouter une ligne » pour saisir le premier produit reçu.
                  </p>
                </div>
              )}
            </div>
          </section>

          <div className='rounded-2xl border border-blue-200 bg-blue-50 p-5'>
            {(receptionError || state.errors.lines || state.errors.form) && (
              <p
                className='mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'
                role='alert'
              >
                {receptionError ?? state.errors.lines ?? state.errors.form}
              </p>
            )}
            <div className='sm:flex sm:items-center sm:justify-between sm:gap-6'>
              <div>
                <p className='font-semibold text-blue-950'>Enregistrement de la réception</p>
                <p className='mt-1 text-sm leading-6 text-blue-800'>
                  La réception sera enregistrée dans l’historique avec ses produits, ses quantités et ses montants TTC.
                </p>
              </div>
              <button
                className='mt-4 w-full rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:mt-0 sm:w-auto'
                disabled={pending}
                type='submit'
              >
                {pending ? 'Enregistrement…' : 'Valider et enregistrer'}
              </button>
            </div>
          </div>
    </form>
  );
};

export default ReceptionDraftForm;
