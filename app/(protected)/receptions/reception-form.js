'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  calculateReceptionLine,
  changeReceptionLineProduct,
  createEmptyReceptionLine,
  formatReceptionMoney,
  formatReceptionUnitCost,
  getReceptionPackagings,
  validateReceptionDraft,
  validateReceptionLine,
} from '../../../lib/receptions.js';
import { summarizeReceptionDraft, validateReceptionDocument } from '../../../lib/reception-draft.js';
import { TAB_PARAMETER } from '../../../lib/tab-navigation.js';
import ConfirmationDialog from '../confirmation-dialog.js';
import { useInlineSave } from '../components/editable-card.js';
import { EditingLink, useEditingSession } from '../components/editing-session.js';
import { Pagination, ReadError, formatReceptionShortDate } from './reception-ui.js';
import styles from './receptions.module.css';
import { createReception } from './actions.js';

const SUPPLIERS_TAB_HREF = `/receptions?${new URLSearchParams({ [TAB_PARAMETER]: 'fournisseurs' })}`;

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
  baseUnits, calculation, errors, index, line, onCancel, onChange, onProductChange, onValidate, products, editing,
}) => {
  const product = getProduct(products, line.productId);
  const unitLabel = getUnitLabel(baseUnits, product).toLocaleLowerCase('fr');
  const quantityUnitLabel = getQuantityUnitLabel(baseUnits, product);
  const receptionPackagings = getReceptionPackagings(product);
  const packaging = receptionPackagings.find(({ id }) => id === line.packagingId);
  const editorRef = useRef(null);
  const quantityField = line.quantityMode === 'PACKAGING' ? 'packagingCount' : 'directQuantity';
  const quantityId = `${line.id}-${line.quantityMode === 'PACKAGING' ? 'packaging-count' : 'direct-quantity'}`;
  useLayoutEffect(() => { editorRef.current?.querySelector('select')?.focus(); }, [line.id]);
  useEffect(() => {
    if (Object.keys(errors).length) editorRef.current?.querySelector('[aria-invalid="true"]')?.focus();
  }, [errors]);
  const error = (name, id) => errors[name] && <p className={styles.fieldError} id={`${id}-error`}>{errors[name]}</p>;

  return (
    <fieldset ref={editorRef} className={styles.lineForm} onKeyDown={(event) => {
      if (event.key === 'Enter' && event.target.tagName === 'INPUT') { event.preventDefault(); onValidate(); }
    }}>
      <legend className='sr-only'>Ligne {index + 1}</legend>
      <h3>{editing ? 'Modifier la ligne' : 'Ajouter une ligne'}</h3>
      <div className={styles.lineGrid}>
        <div className={styles.fullField}>
          <label htmlFor={`${line.id}-product`}>Produit du catalogue</label>
          <select id={`${line.id}-product`} value={line.productId} onChange={(event) => onProductChange(event.target.value)} aria-invalid={Boolean(errors.product)} aria-describedby={errors.product ? `${line.id}-product-error` : undefined}>
            <option value=''>Sélectionner un produit</option>
            {products.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.code} · {candidate.designation}</option>)}
          </select>
          {error('product', `${line.id}-product`)}
        </div>
        <div>
          <label htmlFor={`${line.id}-quantity-mode`}>Mode de saisie</label>
          <select id={`${line.id}-quantity-mode`} disabled={!product} value={line.quantityMode} onChange={(event) => onChange({ directQuantity: '', packagingCount: '', packagingId: '', quantityMode: event.target.value })}>
            <option value='DIRECT'>Quantité directe</option>
            <option value='PACKAGING' disabled={!receptionPackagings.length}>Nombre de conditionnements</option>
          </select>
          <p className={styles.lineHelp}>{!product ? 'Sélectionnez d’abord un produit.' : !receptionPackagings.length ? 'Aucun conditionnement activé pour la réception : saisie directe uniquement.' : `Unité de base : ${unitLabel}`}</p>
          {product && <p className={styles.lineHelp}>Changer de produit efface les quantités, le conditionnement et le montant. Changer de mode efface les quantités et le conditionnement.</p>}
        </div>
        {line.quantityMode === 'PACKAGING' && <div>
          <label htmlFor={`${line.id}-packaging`}>Conditionnement</label>
          <select id={`${line.id}-packaging`} value={line.packagingId} onChange={(event) => onChange({ packagingId: event.target.value })} aria-invalid={Boolean(errors.packaging)} aria-describedby={errors.packaging ? `${line.id}-packaging-error` : undefined}>
            <option value=''>Sélectionner</option>
            {receptionPackagings.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label} · {candidate.quantity} {quantityUnitLabel}</option>)}
          </select>
          {error('packaging', `${line.id}-packaging`)}
        </div>}
        <div>
          <label htmlFor={quantityId}>{line.quantityMode === 'PACKAGING' ? 'Nombre de conditionnements' : `Quantité en ${product ? quantityUnitLabel : 'unités de base'}`}</label>
          <input id={quantityId} disabled={!product} inputMode='numeric' type='text' value={line[quantityField]} onChange={(event) => onChange({ [quantityField]: event.target.value })} placeholder='Ex. 10' aria-invalid={Boolean(errors[quantityField])} aria-describedby={errors[quantityField] ? `${quantityId}-error` : undefined} />
          {error(quantityField, quantityId)}
        </div>
        <div>
          <label htmlFor={`${line.id}-amount`}>Montant TTC total de la ligne · DA</label>
          <input id={`${line.id}-amount`} inputMode='decimal' type='text' value={line.amount} onChange={(event) => onChange({ amount: event.target.value })} placeholder='Ex. 1200,00' aria-invalid={Boolean(errors.amount)} aria-describedby={`${line.id}-amount-help${errors.amount ? ` ${line.id}-amount-error` : ''}`} />
          <p className={styles.lineHelp} id={`${line.id}-amount-help`}>Le montant de cette ligne, pas un prix unitaire. Zéro est accepté s’il est explicite.</p>
          {error('amount', `${line.id}-amount`)}
        </div>
      </div>
      <div className={styles.linePreview}>
        <dl>
          <div><dt>Quantité totale reçue</dt><dd>{calculation.quantityInBaseUnits === null ? '—' : `${calculation.quantityInBaseUnits} ${quantityUnitLabel}`}</dd></div>
          <div><dt>Coût unitaire TTC calculé</dt><dd>{formatReceptionUnitCost(calculation)}{calculation.amountInCentimes !== null && calculation.quantityInBaseUnits !== null && ` / ${unitLabel}`}</dd></div>
        </dl>
        {line.quantityMode === 'PACKAGING' && packaging && calculation.quantityInBaseUnits !== null && <p className={styles.lineHelp}>{line.packagingCount} × {packaging.quantity} {quantityUnitLabel} = {calculation.quantityInBaseUnits} {quantityUnitLabel}</p>}
        <p className={styles.lineHelp}>Montant TTC de la ligne ÷ quantité en unité de base. Aucun prix de vente n’est utilisé.</p>
      </div>
      <div className={styles.lineFormActions}><button className={styles.secondary} onClick={onCancel} type='button'>Annuler</button><button className={styles.primary} onClick={onValidate} type='button'>Valider la ligne</button></div>
      <p className={styles.lineHelp}>Valider la ligne l’ajoute au brouillon. Le stock ne change qu’à l’enregistrement final.</p>
    </fieldset>
  );
};


const ReceptionLineSummary = ({ baseUnits, index, line, onEdit, onRemove, products, disabled }) => {
  const product = getProduct(products, line.productId);
  const calculation = calculateReceptionLine(line, product);
  const unitLabel = getUnitLabel(baseUnits, product).toLocaleLowerCase('fr');
  const packaging = line.quantityMode === 'PACKAGING'
    ? getReceptionPackagings(product).find(({ id }) => id === line.packagingId) : null;
  return (
    <article className={styles.line}>
      <div className={styles.lineTop}>
        <div><p className={styles.lineLabel}>Ligne {index + 1} · brouillon</p><h3>{product?.designation}</h3><p>{product?.code} · {packaging ? `${line.packagingCount} × ${packaging.label}` : 'Saisie directe'}</p></div>
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
  const discardLineRef = useRef(null);
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
  const missingPrerequisite = !suppliers.length || !products.length;
  const hasPreparedDraft = documentValidated || lines.length > 0 || Boolean(lineDraft)
    || documentDraft.supplierId !== '' || documentDraft.supplierReference !== '' || documentDraft.receptionDate !== initialDate;
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
    setLineDraft((line) => ({
      ...changeReceptionLineProduct(line, id),
      quantityMode: getReceptionPackagings(getProduct(products, id)).length ? 'PACKAGING' : 'DIRECT',
    })); setLineErrors({}); setReceptionError(null);
  };
  const addLine = () => {
    if (lineDraft || blocked || lines.length >= 100) return;
    const id = `reception-line-${nextLineId.current++}`;
    setEditingLineId(null); setLineDraft({ ...createEmptyReceptionLine(id), quantityMode: 'PACKAGING' }); setLineErrors({}); setReceptionError(null);
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
  return (
    <>
      <div className={styles.draftMeta}><button className={styles.quiet} disabled={pending} onClick={() => session.request(onCancel)} type='button'>← Retour à l’historique</button><span className={`${styles.badge} ${styles.draftBadge}`}>Brouillon non enregistré</span></div>
      {catalogError ? <section className={styles.card}><div className={styles.empty}><h3>Préparation indisponible</h3><ReadError>{catalogError}</ReadError></div></section> : missingPrerequisite && !hasPreparedDraft ? <section className={styles.card}>
        <div className={styles.empty}><h2>Avant de préparer une réception</h2><p>Complétez les prérequis pour saisir les marchandises reçues.</p></div>
        <div className={styles.prerequisite}>
          {!suppliers.length && <p>Ajoutez un fournisseur actif avant de préparer une réception.</p>}
          {!products.length && <p>Ajoutez un produit au catalogue avant de préparer les lignes.</p>}
          {!suppliers.length && canReadSuppliers && <EditingLink href={SUPPLIERS_TAB_HREF}>Consulter les fournisseurs</EditingLink>}
        </div>
      </section> : (
        <form ref={formRef} action={save} onSubmit={verify} noValidate aria-busy={pending} id='new-reception-form'>
          <input name='lines' type='hidden' value={JSON.stringify(lines.map((line) => ({ ...line, baseUnit: getProduct(products, line.productId)?.baseUnit ?? '' })))} />
          <input name='submissionKey' type='hidden' value={submissionKey} />
          {Object.entries(document).map(([name, value]) => <input key={name} name={name} type='hidden' value={value} />)}
          <fieldset disabled={blocked} className={styles.draftLayout}>
            <div className={styles.stack}>
              <section className={`${styles.card} ${documentEditing ? styles.editing : ''}`} ref={documentRef} aria-labelledby='reception-document-title' onKeyDown={(event) => {
                if (event.key === 'Enter' && event.target.tagName === 'INPUT' && documentEditing) { event.preventDefault(); validateDocument(); }
              }}>
                <div className={styles.cardHeader}><h2 id='reception-document-title'><span className={styles.step}>1</span>Document fournisseur</h2>{documentEditing ? <span className={`${styles.badge} ${styles.blue}`}>Saisie en cours</span> : <button className={styles.secondary} onClick={() => { setDocumentDraft(document); setDocumentErrors({}); setDocumentEditing(true); }} type='button'>{documentValidated ? 'Modifier' : 'Renseigner'}</button>}</div>
                {documentEditing ? <>
                  <div className={styles.documentFields}>
                    <div><label htmlFor='reception-supplier'>Fournisseur actif</label><select id='reception-supplier' value={documentDraft.supplierId} onChange={(event) => changeDocument('supplierId', event.target.value)} aria-invalid={Boolean(documentErrors.supplierId)} aria-describedby={documentErrors.supplierId ? 'reception-supplier-error' : undefined}><option value=''>Sélectionner un fournisseur</option>{suppliers.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}</select>{documentErrors.supplierId && <p className='mt-2 text-xs text-red-700' id='reception-supplier-error'>{documentErrors.supplierId}</p>}</div>
                    <div><label htmlFor='reception-date'>Date de réception</label><input id='reception-date' type='date' value={documentDraft.receptionDate} onChange={(event) => changeDocument('receptionDate', event.target.value)} aria-invalid={Boolean(documentErrors.receptionDate)} aria-describedby={documentErrors.receptionDate ? 'reception-date-error' : undefined} />{documentErrors.receptionDate && <p className='mt-2 text-xs text-red-700' id='reception-date-error'>{documentErrors.receptionDate}</p>}</div>
                    <div><label htmlFor='supplier-reference'>Référence du document</label><input id='supplier-reference' maxLength={100} value={documentDraft.supplierReference} onChange={(event) => changeDocument('supplierReference', event.target.value)} placeholder='Ex. BL-2026-0042' aria-invalid={Boolean(documentErrors.supplierReference)} aria-describedby={documentErrors.supplierReference ? 'supplier-reference-error' : undefined} />{documentErrors.supplierReference && <p className='mt-2 text-xs text-red-700' id='supplier-reference-error'>{documentErrors.supplierReference}</p>}</div>
                  </div>
                  {!suppliers.length && <div className={styles.prerequisite}><p>Aucun fournisseur actif disponible. Un fournisseur actif est nécessaire pour enregistrer la réception.</p>{canReadSuppliers && <EditingLink href={SUPPLIERS_TAB_HREF}>Consulter les fournisseurs</EditingLink>}</div>}
                  <div className={styles.localActions}><small>Informations du brouillon</small>{documentValidated && <button className={styles.secondary} onClick={cancelDocument} type='button'>Annuler</button>}<button className={styles.primary} onClick={validateDocument} type='button'>Valider les informations</button></div>
                </> : <dl className={styles.documentSummary}><div><dt>Fournisseur</dt><dd>{supplier?.name ?? 'À renseigner'}</dd></div><div><dt>Date de réception</dt><dd>{formatReceptionShortDate(document.receptionDate)}</dd></div><div><dt>Référence fournisseur</dt><dd>{document.supplierReference || 'À renseigner'}</dd></div></dl>}
              </section>
              <section className={`${styles.card} ${lineDraft ? styles.editing : ''}`} aria-labelledby='reception-lines-title'>
                <div className={styles.cardHeader}><div><h2 id='reception-lines-title'><span className={styles.step}>2</span>Marchandises reçues</h2></div><button className={styles.secondary} ref={addRef} disabled={Boolean(lineDraft) || !products.length || lines.length >= 100} onClick={addLine} type='button'>{lines.length >= 100 ? 'Limite de 100 lignes' : '+ Ajouter une ligne'}</button></div>
                {!products.length && <p className={styles.prerequisite}>Aucun produit disponible. Complétez le catalogue avant de préparer les lignes.</p>}
                {lines.length > 0 && <div className={styles.filters} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }}><div><label htmlFor='draft-line-search'>Rechercher dans le brouillon</label><input id='draft-line-search' type='search' disabled={Boolean(lineDraft)} value={lineQuery} onChange={(event) => { setLineQuery(event.target.value); setLinePage(1); }} placeholder='Code ou désignation' /></div><div><label htmlFor='draft-line-mode'>Mode de quantité</label><select id='draft-line-mode' disabled={Boolean(lineDraft)} value={lineMode} onChange={(event) => { setLineMode(event.target.value); setLinePage(1); }}><option value='ALL'>Tous les modes</option><option value='DIRECT'>Quantité directe</option><option value='PACKAGING'>Conditionnement</option></select></div></div>}
                {visibleLines.map((line) => line.id === editingLineId ? <div className={styles.editor} key={line.id}><ReceptionLineForm baseUnits={baseUnits} calculation={lineDraftCalculation} errors={lineErrors} editing index={lines.findIndex(({ id }) => id === line.id)} line={lineDraft} onCancel={() => discardLineRef.current?.showModal()} onChange={updateLineDraft} onProductChange={changeDraftProduct} onValidate={validateLineDraft} products={products} /></div> : <ReceptionLineSummary key={line.id} baseUnits={baseUnits} index={lines.findIndex(({ id }) => id === line.id)} line={line} disabled={Boolean(lineDraft)} onEdit={() => editLine(line)} onRemove={() => { setLineToRemove(line); requestAnimationFrame(() => removeRef.current?.showModal()); }} products={products} />)}
                {lineDraft && !editingLineId && <div className={styles.editor}><ReceptionLineForm baseUnits={baseUnits} calculation={lineDraftCalculation} errors={lineErrors} index={lines.length} line={lineDraft} onCancel={() => discardLineRef.current?.showModal()} onChange={updateLineDraft} onProductChange={changeDraftProduct} onValidate={validateLineDraft} products={products} /></div>}
                {!lines.length && !lineDraft && <div className={styles.empty}><h3>Aucune ligne préparée</h3><p>Ajoutez les produits, leur quantité et le montant TTC de chaque ligne.</p></div>}
                {lines.length > 0 && !filteredLines.length && <div className={styles.empty}><h3>Aucune ligne trouvée</h3><p>Modifiez la recherche ou le mode de quantité.</p></div>}
                {lines.length > 0 && <Pagination page={activeLinePage} totalPages={totalLinePages} totalResults={filteredLines.length} label='Pagination des lignes du brouillon' onChange={setLinePage} disabled={Boolean(lineDraft)} />}
                <p className={styles.listHelp}>Les lignes restent modifiables jusqu’à l’enregistrement de la réception.</p>
              </section>
            </div>
            <aside className={styles.sidebar} aria-labelledby='reception-summary-title'>
              <section className={styles.card}>
                <div className={styles.total}>
                  <p className={styles.eyebrow}>Récapitulatif du brouillon</p>
                  <h2 id='reception-summary-title'>Total des lignes validées</h2>
                  <div className={styles.amount}>{summary.amountInCentimes === null ? '—' : formatReceptionMoney(summary.amountInCentimes)}</div>
                  <p>{validatedLines.length} ligne{validatedLines.length > 1 ? 's' : ''} validée{validatedLines.length > 1 ? 's' : ''}{lineDraft && ' · 1 ligne en cours, non incluse'}</p>
                  {!validatedLines.length && <p className={styles.summaryHelp}>Validez une ligne pour calculer le récapitulatif.</p>}
                  {lineDraft && validatedLines.length > 0 && <p className={styles.summaryHelp}>Total partiel : la ligne en cours n’est pas incluse.</p>}
                  {validatedLines.length > 0 && !summary.complete && <p className={styles.summaryHelp}>Récapitulatif non calculable : vérifiez les lignes.</p>}
                  <div className={styles.quantityTotals}>{quantities}</div>
                  <p className={styles.summaryHelp}>Quantités regroupées par unité, jamais additionnées entre unités différentes.</p>
                </div>
                <div className={styles.finalActions}><p>La confirmation enregistrera la réception et ses entrées de stock. Aucun encaissement ou paiement fournisseur ne sera créé.</p><button className={styles.primary} ref={submitRef} type='submit'>Vérifier la réception</button></div>
              </section>
              <p className={styles.info}>La référence identifie le document fournisseur. Le total ci-dessus est calculé à partir des lignes saisies.</p>
            </aside>
          </fieldset>
          {(receptionError || state.errors.lines || state.errors.form) && <p data-reception-error tabIndex={-1} className={styles.error} role='alert'>{receptionError ?? state.errors.lines ?? state.errors.form}</p>}
          {uncertain && <div className={styles.error}><p>Le résultat de l’enregistrement doit être vérifié. Réessayez avec les mêmes informations ; la demande reste conservée.</p><button className={styles.secondary} disabled={pending} onClick={() => confirmationRef.current?.showModal()} type='button'>Vérifier et réessayer</button></div>}
          <ConfirmationDialog dialogRef={confirmationRef} confirmType='button' title='Enregistrer cette réception ?' confirmLabel='Enregistrer la réception' pending={pending} pendingLabel='Enregistrement…' onConfirm={submit} onClose={() => submitRef.current?.focus()}>
            <dl className={styles.documentSummary}><div><dt>Fournisseur</dt><dd>{supplier?.name}</dd></div><div><dt>Référence</dt><dd>{document.supplierReference}</dd></div><div><dt>Date</dt><dd>{formatReceptionShortDate(document.receptionDate)}</dd></div></dl>
            <p><strong>{lines.length} ligne{lines.length > 1 ? 's' : ''} · {formatReceptionMoney(summary.amountInCentimes)}</strong></p>
            {quantities}<p>L’enregistrement est définitif dans ce parcours. Il conserve les informations historiques et crée les entrées de stock prévues.</p><p>Aucun paiement fournisseur ni encaissement de caisse n’est créé.</p>
          </ConfirmationDialog>
          <ConfirmationDialog dialogRef={discardLineRef} confirmType='button' title='Abandonner la saisie de cette ligne ?' confirmLabel='Abandonner la saisie' onClose={() => requestAnimationFrame(() => formRef.current?.querySelector('[id$="-product"]')?.focus())} onConfirm={() => { discardLineRef.current?.close(); cancelLineDraft(); }}><p>La ligne précédemment validée restera inchangée. Une nouvelle ligne non validée ne sera pas ajoutée.</p></ConfirmationDialog>
          <ConfirmationDialog dialogRef={removeRef} confirmType='button' title='Retirer cette ligne du brouillon ?' confirmLabel='Retirer la ligne' tone='red' onClose={() => addRef.current?.focus()} onConfirm={() => { setLines((current) => current.filter(({ id }) => id !== lineToRemove.id)); setLineToRemove(null); removeRef.current?.close(); }}><p>{getProduct(products, lineToRemove?.productId)?.designation}</p><p>La ligne sera retirée de la préparation. Cette action n’effectue aucune sortie de stock.</p></ConfirmationDialog>
        </form>
      )}
    </>
  );
};

export default ReceptionDraftForm;
