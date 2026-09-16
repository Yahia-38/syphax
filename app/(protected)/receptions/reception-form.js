'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  calculateReceptionLine,
  changeReceptionLineProduct,
  createEmptyReceptionLine,
  formatReceptionDate,
  formatReceptionMoney,
  formatReceptionUnitCost,
  validateReceptionDraft,
  validateReceptionLine,
} from '../../../lib/receptions.js';
import { summarizeReceptionDraft, validateReceptionDocument } from '../../../lib/reception-draft.js';
import ConfirmationDialog from '../confirmation-dialog.js';
import { useInlineSave } from '../components/editable-card.js';
import { EditingLink, useEditingSession } from '../components/editing-session.js';
import { Pagination, ReadError } from './reception-ui.js';
import styles from './receptions.module.css';
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

const getQuantityUnitLabel = (baseUnits, product) => ({
  PIECE: 'pièces', BOUTEILLE: 'bouteilles', BOITE: 'boîtes', SACHET: 'sachets',
}[product?.baseUnit] ?? getUnitLabel(baseUnits, product).toLocaleLowerCase('fr'));

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
  const quantityUnitLabel = getQuantityUnitLabel(baseUnits, product);
  const packaging = product?.packagings.find(({ id }) => id === line.packagingId);
  const editorRef = useRef(null);
  useLayoutEffect(() => { editorRef.current?.querySelector('select')?.focus(); }, [line.id]);
  useEffect(() => {
    if (Object.keys(errors).length) editorRef.current?.querySelector('[aria-invalid="true"]')?.focus();
  }, [errors]);

  return (
    <fieldset ref={editorRef} className='rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5'>
      <legend className='sr-only'>Ligne {index + 1}</legend>
      <div>
        <p className='text-sm font-semibold text-slate-900'>
          Saisie de la ligne {index + 1}
        </p>
        <p className='mt-1 text-xs text-slate-500'>
          Validation locale : aucun stock écrit. Changer de produit réinitialise quantité, conditionnement et montant ; changer de mode réinitialise la quantité.
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
              onChange={(event) => onChange({ amount: event.target.value })}
              placeholder='Ex. 120,00'
              required
              type='text'
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
            {calculation.quantityInBaseUnits ?? '—'} {quantityUnitLabel}
          </p>
          <p className='mt-1 text-xs leading-5 text-blue-800'>
            {line.quantityMode === 'PACKAGING'
              ? packaging && calculation.quantityInBaseUnits !== null
                ? `${line.packagingCount} × ${packaging.quantity} ${quantityUnitLabel} = ${calculation.quantityInBaseUnits} ${quantityUnitLabel}`
                : 'Choisissez un conditionnement et renseignez son nombre.'
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

const ReceptionLineSummary = ({ baseUnits, index, line, onEdit, onRemove, products, disabled }) => {
  const product = getProduct(products, line.productId);
  const calculation = calculateReceptionLine(line, product);
  const unitLabel = getUnitLabel(baseUnits, product).toLocaleLowerCase('fr');
  const packaging = line.quantityMode === 'PACKAGING'
    ? product?.packagings.find(({ id }) => id === line.packagingId) : null;
  return (
    <article className={styles.line}>
      <div className={styles.lineTop}>
        <div><p>Ligne {index + 1} · Validée dans le brouillon</p><h3>{product?.code} — {product?.designation}</h3><p>{packaging ? `${line.packagingCount} × ${packaging.label} de ${packaging.quantity} ${unitLabel}` : 'Quantité saisie directement'}</p></div>
        <div className={styles.lineActions}><button className={styles.quiet} disabled={disabled} onClick={onEdit} type='button'>Modifier</button><button className={styles.danger} disabled={disabled} onClick={onRemove} type='button'>Retirer</button></div>
      </div>
      <dl className={styles.lineValues}>
        <div><dt>Quantité reçue</dt><dd>{calculation.quantityInBaseUnits ?? '—'} {getQuantityUnitLabel(baseUnits, product)}</dd></div>
        <div><dt>Montant TTC de ligne</dt><dd>{formatReceptionMoney(calculation.amountInCentimes)}</dd></div>
        <div><dt>Coût unitaire TTC</dt><dd>{formatReceptionUnitCost(calculation)} / {unitLabel}</dd></div>
      </dl>
    </article>
  );
};

const ReceptionDraftForm = ({
  baseUnits, initialDate, onCancel, onSuccess, products, submissionKey, suppliers, catalogError, canReadSuppliers,
}) => {
  const nextLineId = useRef(1);
  const session = useEditingSession();
  const register = session?.register;
  const activeRef = useRef({ dirty: false, pending: false, discard: onCancel });
  const lockedRef = useRef(false);
  const documentRef = useRef(null);
  const confirmationRef = useRef(null);
  const removeRef = useRef(null);
  const submitRef = useRef(null);
  const addRef = useRef(null);
  const submittedDataRef = useRef(null);
  const [document, setDocument] = useState({ supplierId: '', receptionDate: initialDate, supplierReference: '' });
  const [documentDraft, setDocumentDraft] = useState(document);
  const [documentEditing, setDocumentEditing] = useState(true);
  const [documentValidated, setDocumentValidated] = useState(false);
  const [documentErrors, setDocumentErrors] = useState({});
  const [editingLineId, setEditingLineId] = useState(null);
  const [lineDraft, setLineDraft] = useState(null);
  const [lineErrors, setLineErrors] = useState({});
  const [lines, setLines] = useState([]);
  const [lineToRemove, setLineToRemove] = useState(null);
  const [receptionError, setReceptionError] = useState(null);
  const [lineQuery, setLineQuery] = useState('');
  const [lineMode, setLineMode] = useState('ALL');
  const [linePage, setLinePage] = useState(1);
  const onPending = useCallback((value) => {
    lockedRef.current = value;
    activeRef.current.pending = value;
  }, []);
  const saved = useCallback((message, result) => {
    activeRef.current.dirty = false;
    activeRef.current.pending = false;
    onSuccess(message, result);
  }, [onSuccess]);
  const action = useCallback(async (previous, data) => {
    const result = await createReception(previous, data);
    if (result.errors.supplierId || result.errors.receptionDate || result.errors.supplierReference) {
      setDocumentDraft(document);
      setDocumentErrors(result.errors);
      setDocumentEditing(true);
    }
    return result;
  }, [document]);
  const { state, save, pending, formRef } = useInlineSave({
    action, initialState: INITIAL_RECEPTION_STATE, onSuccess: saved, onPending,
    failureMessage: 'La réponse à l’enregistrement n’a pas pu être confirmée. Réessayez avec les mêmes informations.',
  });
  const uncertain = Boolean(state.errors.form && state.revision > 0);
  const blocked = pending || uncertain;
  const lineDraftProduct = lineDraft ? getProduct(products, lineDraft.productId) : null;
  const lineDraftCalculation = useMemo(() => lineDraft ? calculateReceptionLine(lineDraft, lineDraftProduct) : null, [lineDraft, lineDraftProduct]);
  const validatedLines = lines.filter(({ id }) => id !== editingLineId);
  const summary = summarizeReceptionDraft(validatedLines, products);
  const supplier = suppliers.find(({ id }) => id === document.supplierId);
  const filteredLines = lines.filter((line) => {
    const product = getProduct(products, line.productId);
    return `${product?.code} ${product?.designation}`.toLocaleLowerCase('fr').includes(lineQuery.trim().toLocaleLowerCase('fr'))
      && (lineMode === 'ALL' || lineMode === line.quantityMode);
  });
  const totalLinePages = Math.max(1, Math.ceil(filteredLines.length / 10));
  const activeLinePage = Math.min(linePage, totalLinePages);
  const visibleLines = filteredLines.slice((activeLinePage - 1) * 10, activeLinePage * 10);

  useLayoutEffect(() => register?.(activeRef.current), [register]);
  useLayoutEffect(() => {
    activeRef.current.dirty = documentValidated || lines.length > 0 || Boolean(lineDraft)
      || documentDraft.supplierId !== '' || documentDraft.supplierReference !== '' || documentDraft.receptionDate !== initialDate;
  }, [documentValidated, documentDraft, initialDate, lines, lineDraft]);
  useLayoutEffect(() => {
    if (documentEditing) documentRef.current?.querySelector('select')?.focus();
  }, [documentEditing]);
  useEffect(() => {
    if (Object.keys(documentErrors).length) documentRef.current?.querySelector('[aria-invalid="true"]')?.focus();
  }, [documentErrors]);

  const changeDocument = (name, value) => {
    setDocumentDraft((current) => ({ ...current, [name]: value }));
    setDocumentErrors({});
    setReceptionError(null);
  };
  const validateDocument = () => {
    const errors = validateReceptionDocument(documentDraft, suppliers);
    setDocumentErrors(errors);
    if (Object.keys(errors).length) return;
    setDocument({ ...documentDraft });
    setDocumentValidated(true);
    setDocumentEditing(false);
    requestAnimationFrame(() => documentRef.current?.querySelector('button')?.focus());
  };
  const cancelDocument = () => {
    setDocumentDraft(document);
    setDocumentErrors({});
    setDocumentEditing(false);
    requestAnimationFrame(() => documentRef.current?.querySelector('button')?.focus());
  };
  const updateLineDraft = (changes) => {
    setLineDraft((line) => ({ ...line, ...changes })); setLineErrors({}); setReceptionError(null);
  };
  const changeDraftProduct = (id) => {
    setLineDraft((line) => changeReceptionLineProduct(line, id)); setLineErrors({}); setReceptionError(null);
  };
  const addLine = () => {
    if (lineDraft || blocked || lines.length >= 100) return;
    const id = `reception-line-${nextLineId.current++}`;
    setEditingLineId(null); setLineDraft(createEmptyReceptionLine(id)); setLineErrors({}); setReceptionError(null);
  };
  const cancelLineDraft = () => {
    setEditingLineId(null); setLineDraft(null); setLineErrors({}); setReceptionError(null);
    requestAnimationFrame(() => addRef.current?.focus());
  };
  const editLine = (line) => {
    if (lineDraft || blocked) return;
    setEditingLineId(line.id); setLineDraft({ ...line }); setLineErrors({}); setReceptionError(null);
  };
  const validateLineDraft = () => {
    const validation = validateReceptionLine(lineDraft, lineDraftProduct);
    if (validation.errors) { setLineErrors(validation.errors); return; }
    setLines((current) => editingLineId ? current.map((line) => line.id === editingLineId ? { ...lineDraft } : line) : [...current, { ...lineDraft }]);
    if (!editingLineId) { setLineQuery(''); setLineMode('ALL'); setLinePage(Math.ceil((lines.length + 1) / 10)); }
    cancelLineDraft();
  };
  const verify = (event) => {
    event.preventDefault();
    if (lockedRef.current) return;
    if (uncertain) { confirmationRef.current?.showModal(); return; }
    const validation = validateReceptionDraft({ hasLineDraft: Boolean(lineDraft), lineCount: lines.length });
    const error = documentEditing || !documentValidated ? 'Validez les informations du document fournisseur.'
      : validation.error ?? (!summary.complete ? 'Le récapitulatif n’est pas calculable. Vérifiez les lignes et leurs limites numériques.' : null);
    setReceptionError(error);
    if (error) { requestAnimationFrame(() => formRef.current?.querySelector('[data-reception-error]')?.focus()); return; }
    confirmationRef.current?.showModal();
  };
  const submit = () => {
    if (lockedRef.current) return;
    const data = uncertain ? submittedDataRef.current : new FormData(formRef.current);
    submittedDataRef.current = data;
    save(data);
  };
  useEffect(() => {
    if (!pending && state.revision) confirmationRef.current?.close();
  }, [state.revision, pending]);

  const quantities = <dl>{summary.quantities.map(({ unit, quantity }) => <div className={styles.unitTotal} key={unit}><dt>{baseUnits.find(({ code }) => code === unit)?.label ?? unit}</dt><dd>{quantity ?? 'Non calculable'}</dd></div>)}</dl>;
  const missingPrerequisite = catalogError || !suppliers.length || !products.length;
  return (
    <>
      <div className={styles.draftMeta}><button className={styles.quiet} disabled={pending} onClick={() => session.request(onCancel)} type='button'>← Retour à l’historique</button><span className={`${styles.badge} ${styles.amber}`}>Brouillon non enregistré</span></div>
      {missingPrerequisite ? <section className={styles.card}><div className={styles.empty}><h3>Préparation indisponible</h3>{catalogError ? <ReadError>{catalogError}</ReadError> : <><p>{!suppliers.length ? 'Ajoutez un fournisseur actif avant de préparer une réception.' : 'Ajoutez un produit au catalogue avant de préparer une réception.'}</p>{!suppliers.length && canReadSuppliers && <EditingLink className={styles.secondary} href='/receptions?onglet=fournisseurs'>Consulter les fournisseurs</EditingLink>}</>}</div></section> : (
        <form ref={formRef} action={save} onSubmit={verify} noValidate aria-busy={pending} id='new-reception-form'>
          <input name='lines' type='hidden' value={JSON.stringify(lines.map((line) => ({ ...line, baseUnit: getProduct(products, line.productId)?.baseUnit ?? '' })))} />
          <input name='submissionKey' type='hidden' value={submissionKey} />
          {Object.entries(document).map(([name, value]) => <input key={name} name={name} type='hidden' value={value} />)}
          <fieldset disabled={blocked} className={styles.draftLayout}>
            <div className={styles.stack}>
              <section className={styles.card} ref={documentRef} aria-labelledby='reception-document-title'>
                <div className={styles.cardHeader}><h2 id='reception-document-title'><span className={styles.step}>1</span>Document fournisseur</h2>{!documentEditing && <button className={styles.secondary} onClick={() => { setDocumentDraft(document); setDocumentErrors({}); setDocumentEditing(true); }} type='button'>{documentValidated ? 'Modifier' : 'Renseigner'}</button>}</div>
                {documentEditing ? <>
                  <div className={styles.documentFields}>
                    <div><label className='text-xs font-semibold' htmlFor='reception-supplier'>Fournisseur actif *</label><select className={INPUT_CLASS} id='reception-supplier' value={documentDraft.supplierId} onChange={(event) => changeDocument('supplierId', event.target.value)} aria-invalid={Boolean(documentErrors.supplierId)} aria-describedby={documentErrors.supplierId ? 'reception-supplier-error' : undefined}><option value=''>Sélectionnez un fournisseur</option>{suppliers.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}</select>{documentErrors.supplierId && <p className='mt-2 text-xs text-red-700' id='reception-supplier-error'>{documentErrors.supplierId}</p>}</div>
                    <div><label className='text-xs font-semibold' htmlFor='reception-date'>Date de réception *</label><input className={INPUT_CLASS} id='reception-date' type='date' value={documentDraft.receptionDate} onChange={(event) => changeDocument('receptionDate', event.target.value)} aria-invalid={Boolean(documentErrors.receptionDate)} aria-describedby={documentErrors.receptionDate ? 'reception-date-error' : undefined} />{documentErrors.receptionDate && <p className='mt-2 text-xs text-red-700' id='reception-date-error'>{documentErrors.receptionDate}</p>}</div>
                    <div><label className='text-xs font-semibold' htmlFor='supplier-reference'>Référence BL / facture *</label><input className={INPUT_CLASS} id='supplier-reference' maxLength={100} value={documentDraft.supplierReference} onChange={(event) => changeDocument('supplierReference', event.target.value)} placeholder='Ex. BL-2026-0042' aria-invalid={Boolean(documentErrors.supplierReference)} aria-describedby={documentErrors.supplierReference ? 'supplier-reference-error' : undefined} />{documentErrors.supplierReference && <p className='mt-2 text-xs text-red-700' id='supplier-reference-error'>{documentErrors.supplierReference}</p>}</div>
                  </div>
                  <div className={styles.localActions}><small>Validation locale · aucun stock écrit</small><button className={styles.secondary} onClick={cancelDocument} type='button'>Annuler</button><button className={styles.primary} onClick={validateDocument} type='button'>Valider les informations</button></div>
                </> : <dl className={styles.documentSummary}><div><dt>Fournisseur</dt><dd>{supplier?.name ?? 'À renseigner'}</dd></div><div><dt>Date de réception</dt><dd>{formatReceptionDate(document.receptionDate)}</dd></div><div><dt>Référence fournisseur</dt><dd>{document.supplierReference || 'À renseigner'}</dd></div></dl>}
              </section>
              <section className={styles.card} aria-labelledby='reception-lines-title'>
                <div className={styles.cardHeader}><div><h2 id='reception-lines-title'><span className={styles.step}>2</span>Marchandises reçues</h2><p>Une saisie à la fois ; chaque quantité garde son unité.</p></div><button className={styles.secondary} ref={addRef} disabled={Boolean(lineDraft) || lines.length >= 100} onClick={addLine} type='button'>{lineDraft ? 'Ligne en cours' : lines.length >= 100 ? 'Limite de 100 lignes' : '+ Ajouter une ligne'}</button></div>
                {lines.length > 0 && <div className={styles.filters}><div><label htmlFor='draft-line-search'>Rechercher dans le brouillon</label><input id='draft-line-search' type='search' disabled={Boolean(lineDraft)} value={lineQuery} onChange={(event) => { setLineQuery(event.target.value); setLinePage(1); }} placeholder='Code ou désignation' /></div><div><label htmlFor='draft-line-mode'>Mode de quantité</label><select id='draft-line-mode' disabled={Boolean(lineDraft)} value={lineMode} onChange={(event) => { setLineMode(event.target.value); setLinePage(1); }}><option value='ALL'>Tous les modes</option><option value='DIRECT'>Quantité directe</option><option value='PACKAGING'>Conditionnement</option></select></div></div>}
                {visibleLines.map((line) => line.id === editingLineId ? <div className={styles.editor} key={line.id}><ReceptionLineForm baseUnits={baseUnits} calculation={lineDraftCalculation} errors={lineErrors} index={lines.findIndex(({ id }) => id === line.id)} line={lineDraft} onCancel={cancelLineDraft} onChange={updateLineDraft} onProductChange={changeDraftProduct} onValidate={validateLineDraft} products={products} /></div> : <ReceptionLineSummary key={line.id} baseUnits={baseUnits} index={lines.findIndex(({ id }) => id === line.id)} line={line} disabled={Boolean(lineDraft)} onEdit={() => editLine(line)} onRemove={() => { setLineToRemove(line); requestAnimationFrame(() => removeRef.current?.showModal()); }} products={products} />)}
                {lineDraft && !editingLineId && <div className={styles.editor}><ReceptionLineForm baseUnits={baseUnits} calculation={lineDraftCalculation} errors={lineErrors} index={lines.length} line={lineDraft} onCancel={cancelLineDraft} onChange={updateLineDraft} onProductChange={changeDraftProduct} onValidate={validateLineDraft} products={products} /></div>}
                {!lines.length && !lineDraft && <div className={styles.empty}><h3>Aucune ligne ajoutée</h3><p>Ajoutez un produit, sa quantité et le montant TTC de sa ligne.</p></div>}
                {lines.length > 0 && !filteredLines.length && <div className={styles.empty}><h3>Aucune ligne trouvée</h3><p>Modifiez la recherche ou le mode de quantité.</p></div>}
                {lines.length > 0 && <Pagination page={activeLinePage} totalPages={totalLinePages} label='Pagination des lignes du brouillon' onChange={setLinePage} disabled={Boolean(lineDraft)} />}
              </section>
            </div>
            <aside className={styles.card} aria-labelledby='reception-summary-title'>
              <div className={styles.total}><h2 id='reception-summary-title'><span className={styles.step}>3</span>Récapitulatif</h2><p className='mt-4'>Total TTC des lignes validées</p><div className={styles.amount}>{summary.amountInCentimes === null ? '—' : formatReceptionMoney(summary.amountInCentimes)}</div><p>{validatedLines.length} ligne{validatedLines.length > 1 ? 's' : ''} validée{validatedLines.length > 1 ? 's' : ''} · tout le brouillon</p>{lineDraft && <p className='mt-3'>Total partiel : la ligne en cours n’est pas incluse.</p>}{!validatedLines.length && <p className='mt-3'>Validez une ligne pour calculer le récapitulatif.</p>}{validatedLines.length > 0 && !summary.complete && <p className='mt-3'>Récapitulatif non calculable : vérifiez les lignes.</p>}<h3>Quantités par unité de base</h3>{summary.quantities.length ? quantities : <p className='mt-3'>Aucune quantité validée.</p>}</div>
              <div className={styles.finalActions}><p>Les validations restent locales jusqu’à la confirmation finale.</p><button className={styles.primary} ref={submitRef} type='submit'>Vérifier la réception</button></div>
            </aside>
          </fieldset>
          {(receptionError || state.errors.lines || state.errors.form) && <p data-reception-error tabIndex={-1} className={styles.error} role='alert'>{receptionError ?? state.errors.lines ?? state.errors.form}</p>}
          {uncertain && <div className={styles.error}><p>Le résultat de l’enregistrement doit être vérifié. Réessayez avec les mêmes informations ; la demande reste conservée.</p><button className={styles.secondary} disabled={pending} onClick={() => confirmationRef.current?.showModal()} type='button'>Vérifier et réessayer</button></div>}
          <ConfirmationDialog dialogRef={confirmationRef} confirmType='button' title='Enregistrer cette réception ?' confirmLabel='Enregistrer la réception' pending={pending} pendingLabel='Enregistrement…' onConfirm={submit} onClose={() => submitRef.current?.focus()}>
            <dl className={styles.documentSummary}><div><dt>Fournisseur</dt><dd>{supplier?.name}</dd></div><div><dt>Référence</dt><dd>{document.supplierReference}</dd></div><div><dt>Date</dt><dd>{formatReceptionDate(document.receptionDate)}</dd></div></dl>
            <p><strong>{lines.length} ligne{lines.length > 1 ? 's' : ''} · {formatReceptionMoney(summary.amountInCentimes)}</strong></p>
            {quantities}<p>L’enregistrement est définitif dans ce parcours. Il conserve les informations historiques et crée les entrées de stock prévues.</p><p>Aucun paiement fournisseur ni encaissement de caisse n’est créé.</p>
          </ConfirmationDialog>
          <ConfirmationDialog dialogRef={removeRef} confirmType='button' title='Retirer cette ligne du brouillon ?' confirmLabel='Retirer la ligne' tone='red' onClose={() => addRef.current?.focus()} onConfirm={() => { setLines((current) => current.filter(({ id }) => id !== lineToRemove.id)); setLineToRemove(null); removeRef.current?.close(); }}><p>{getProduct(products, lineToRemove?.productId)?.designation}</p><p>La ligne sera retirée de la préparation. Cette action n’effectue aucune sortie de stock.</p></ConfirmationDialog>
        </form>
      )}
    </>
  );
};

export default ReceptionDraftForm;
