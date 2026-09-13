'use client';

import { useMemo, useRef, useState } from 'react';

import {
  calculateReceptionLine,
  changeReceptionLineProduct,
  createEmptyReceptionLine,
  validateReceptionDraft,
  validateReceptionLine,
} from '../../../lib/receptions.js';

const INPUT_CLASS = 'mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500';

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
  const normalizedQuery = line.productQuery.trim().toLocaleLowerCase('fr');
  const matchingProducts = products.filter((candidate) => {
    if (candidate.id === line.productId) {
      return true;
    }

    const searchableText = `${candidate.code} ${candidate.designation}`
      .toLocaleLowerCase('fr');

    return !normalizedQuery || searchableText.includes(normalizedQuery);
  });
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
            htmlFor={`${line.id}-product-search`}
          >
            Rechercher dans le catalogue
          </label>
          <input
            className={INPUT_CLASS}
            id={`${line.id}-product-search`}
            maxLength={100}
            onChange={(event) => onChange({ productQuery: event.target.value })}
            placeholder='Code ou désignation du produit'
            type='search'
            value={line.productQuery}
          />
          <label
            className='mt-3 block text-sm font-medium text-slate-700'
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
            {matchingProducts.map((candidate) => (
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
          <p className='mt-2 text-xs text-slate-500'>
            {matchingProducts.length} produit{matchingProducts.length > 1 ? 's' : ''}
            {' '}proposé{matchingProducts.length > 1 ? 's' : ''}.
          </p>
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

const ReceptionForm = ({ baseUnits, products, suppliers }) => {
  const formRef = useRef(null);
  const nextLineId = useRef(1);
  const [editingLineId, setEditingLineId] = useState(null);
  const [formVisible, setFormVisible] = useState(false);
  const [lineDraft, setLineDraft] = useState(null);
  const [lineErrors, setLineErrors] = useState({});
  const [lines, setLines] = useState([]);
  const [receptionError, setReceptionError] = useState(null);
  const [receptionValidated, setReceptionValidated] = useState(false);
  const lineDraftProduct = lineDraft
    ? getProduct(products, lineDraft.productId)
    : null;
  const lineDraftCalculation = useMemo(
    () => lineDraft
      ? calculateReceptionLine(lineDraft, lineDraftProduct)
      : null,
    [lineDraft, lineDraftProduct],
  );

  const updateLineDraft = (changes) => {
    setLineDraft((currentLine) => ({ ...currentLine, ...changes }));
    setLineErrors({});
    setReceptionError(null);
    setReceptionValidated(false);
  };

  const changeDraftProduct = (productId) => {
    setLineDraft((currentLine) =>
      changeReceptionLineProduct(currentLine, productId));
    setLineErrors({});
    setReceptionError(null);
    setReceptionValidated(false);
  };

  const addLine = () => {
    const id = `reception-line-${nextLineId.current}`;

    nextLineId.current += 1;
    setEditingLineId(null);
    setLineDraft(createEmptyReceptionLine(id));
    setLineErrors({});
    setReceptionError(null);
    setReceptionValidated(false);
  };

  const cancelLineDraft = () => {
    setEditingLineId(null);
    setLineDraft(null);
    setLineErrors({});
    setReceptionError(null);
    setReceptionValidated(false);
  };

  const editLine = (line) => {
    setEditingLineId(line.id);
    setLineDraft({ ...line, productQuery: '' });
    setLineErrors({});
    setReceptionError(null);
    setReceptionValidated(false);
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
    setReceptionValidated(false);
  };

  const markReceptionDirty = () => {
    setReceptionError(null);
    setReceptionValidated(false);
  };

  const validateReception = () => {
    const validation = validateReceptionDraft({
      hasLineDraft: Boolean(lineDraft),
      lineCount: lines.length,
    });

    if (validation.error) {
      setReceptionError(validation.error);
      setReceptionValidated(false);
      return;
    }

    if (!formRef.current?.reportValidity()) {
      setReceptionError('Renseignez tous les champs obligatoires de la réception.');
      setReceptionValidated(false);
      return;
    }

    setReceptionError(null);
    setReceptionValidated(true);
  };

  return (
    <div className='mt-8' role='tabpanel'>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
        <div>
          <h2 className='text-xl font-semibold text-slate-900'>
            Réceptions de marchandises
          </h2>
          <p className='mt-1 text-sm leading-6 text-slate-600'>
            Préparez les entrées de marchandises reçues de vos fournisseurs.
          </p>
        </div>
        <button
          aria-controls='new-reception-form'
          aria-expanded={formVisible}
          className='inline-flex w-fit items-center justify-center rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
          onClick={() => setFormVisible((visible) => !visible)}
          type='button'
        >
          {formVisible ? 'Fermer le formulaire' : 'Nouvelle réception'}
        </button>
      </div>

      {!formVisible ? (
        <section className='mt-6 rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm'>
          <h3 className='font-semibold text-slate-900'>
            Aucune nouvelle réception en préparation
          </h3>
          <p className='mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600'>
            Cliquez sur « Nouvelle réception » pour ouvrir le formulaire de saisie.
          </p>
        </section>
      ) : (
        <form
          className='mt-6 space-y-6'
          id='new-reception-form'
          onSubmit={(event) => event.preventDefault()}
          ref={formRef}
        >
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
                  className={INPUT_CLASS}
                  id='reception-supplier'
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
                  className={INPUT_CLASS}
                  id='reception-date'
                  onChange={markReceptionDirty}
                  required
                  type='date'
                />
              </div>
              <div>
                <label className='block text-sm font-medium text-slate-700' htmlFor='supplier-reference'>
                  Référence du document fournisseur
                </label>
                <input
                  className={INPUT_CLASS}
                  id='supplier-reference'
                  maxLength={100}
                  onChange={markReceptionDirty}
                  placeholder='Ex. BL-2026-0042'
                  required
                  type='text'
                />
              </div>
            </div>

            <div className='flex flex-col gap-4 border-y border-slate-200 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6'>
              <div>
                <h2 className='text-lg font-semibold text-slate-900' id='reception-lines-title'>
                  Lignes de réception
                </h2>
                <p className='mt-1 text-sm leading-6 text-slate-600'>
                  Chaque quantité reste attachée à son produit et à son unité de base.
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

          <div className='rounded-2xl border border-amber-200 bg-amber-50 p-5'>
            {receptionError && (
              <p
                className='mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'
                role='alert'
              >
                {receptionError}
              </p>
            )}
            {receptionValidated && (
              <p
                className='mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800'
                role='status'
              >
                La réception est complète et prête pour l’enregistrement de la prochaine étape.
              </p>
            )}
            <div className='sm:flex sm:items-center sm:justify-between sm:gap-6'>
              <div>
                <p className='font-semibold text-amber-900'>Validation du brouillon</p>
                <p className='mt-1 text-sm leading-6 text-amber-800'>
                  Cette validation contrôle la réception sans l’enregistrer, sans mouvement de stock et sans modifier les produits.
                </p>
              </div>
              <button
                className='mt-4 w-full rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 sm:mt-0 sm:w-auto'
                onClick={validateReception}
                type='button'
              >
                Valider la réception
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
};

export default ReceptionForm;
