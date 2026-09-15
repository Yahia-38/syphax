'use client';

import {
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useEditingSession } from '../../components/editing-session.js';
import EditableCard, { EditingButtons, useInlineSave } from '../../components/editable-card.js';

import {
  addProductPackaging,
  removePackagingAction,
} from './packaging-actions.js';

import styles from './product-detail.module.css';
import ProductIcon from './product-icon.js';

const INITIAL_STATE = {
  errors: {},
  message: null,
  revision: 0,
  values: { label: '', quantity: '' },
};

const REMOVE_INITIAL_STATE = {
  error: null,
  revision: 0,
  success: false,
};
const PACKAGINGS_PER_PAGE = 5;

const PackagingRemovalButton = ({ packaging, product }) => {
  const editingSession = useEditingSession();
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const titleId = useId();
  const removePackaging = removePackagingAction.bind(
    null,
    product.id,
    packaging.id,
  );
  const [state, formAction, pending] = useActionState(
    removePackaging,
    REMOVE_INITIAL_STATE,
  );

  useEffect(() => {
    if (state.success) {
      dialogRef.current?.close();
    }
  }, [state.revision, state.success]);

  return (
    <>
      <button
        className={styles.deleteButton}
        onClick={() => {
          const open = () => dialogRef.current?.showModal();
          if (editingSession) editingSession.request(open); else open();
        }}
        ref={triggerRef}
        type='button'
      >
        <ProductIcon name='trash' />Retirer
      </button>

      <dialog
        aria-labelledby={titleId}
        className='m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-0 text-left shadow-xl backdrop:bg-slate-950/40'
        onCancel={(event) => { if (pending) event.preventDefault(); }}
        onClose={() => triggerRef.current?.focus()}
        ref={dialogRef}
      >
        <form action={formAction} className='p-6'>
          <div className='flex h-11 w-11 items-center justify-center rounded-full bg-red-100 text-xl text-red-700'>
            !
          </div>
          <h2
            className='mt-4 text-xl font-semibold text-slate-900'
            id={titleId}
          >
            Retirer ce conditionnement ?
          </h2>
          <p className='mt-2 text-sm leading-6 text-slate-600'>
            Le conditionnement <strong>{packaging.label}</strong> sera retiré
            du produit <strong>{product.code}</strong> — {product.designation}.
            Cette action est irréversible.
          </p>

          {state.error && (
            <p
              className='mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'
              role='alert'
            >
              {state.error}
            </p>
          )}

          <div className='mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end'>
            <button
              className='rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
              disabled={pending}
              onClick={() => dialogRef.current?.close()}
              type='button'
            >
              Annuler
            </button>
            <button
              className='rounded-lg bg-red-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-60'
              disabled={pending}
              type='submit'
            >
              {pending ? 'Suppression…' : 'Retirer définitivement'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
};


const PackagingEditor = ({ productId, quantityUnitLabel, onCancel, onSuccess, onPending }) => {
  const [values, setValues] = useState({ label: '', quantity: '' });
  const { state, pending, formRef, save } = useInlineSave({
    action: addProductPackaging.bind(null, productId), initialState: INITIAL_STATE,
    onSuccess, onPending, failureMessage: 'L’ajout du conditionnement est momentanément indisponible.',
  });
  const quantity = /^\d+$/u.test(values.quantity) ? Number(values.quantity) : null;
  const preview = values.label.trim() && Number.isSafeInteger(quantity) && quantity >= 2 && quantity <= 1000000
    ? `1 ${values.label.trim()} = ${quantity} ${quantityUnitLabel}` : 'Saisissez un libellé et une quantité entière entre 2 et 1 000 000.';
  return (
    <form className={styles.editForm} ref={formRef} onSubmit={(event) => { event.preventDefault(); save(new FormData(event.currentTarget)); }}>
      {state.errors.form && <p className='mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800' role='alert' tabIndex={-1}>{state.errors.form}</p>}
      <fieldset className={styles.packFormGrid} disabled={pending}>
        <div><label className='block text-sm font-medium text-slate-700' htmlFor='packaging-label'>Libellé</label>
          <input aria-invalid={Boolean(state.errors.label)} aria-describedby={state.errors.label ? 'packaging-label-error' : undefined} autoComplete='off'
            className='mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 focus:outline-blue-600 aria-invalid:border-red-500'
            id='packaging-label' maxLength={100} name='label' required value={values.label} onChange={(event) => setValues((previous) => ({ ...previous, label: event.target.value }))} />
          {state.errors.label && <p className='mt-2 text-sm text-red-700' id='packaging-label-error'>{state.errors.label}</p>}
        </div>
        <div><label className='block text-sm font-medium text-slate-700' htmlFor='packaging-quantity'>Quantité en unités de base</label>
          <input aria-invalid={Boolean(state.errors.quantity)} aria-describedby={state.errors.quantity ? 'packaging-quantity-error packaging-preview' : 'packaging-preview'}
            className='mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 focus:outline-blue-600 aria-invalid:border-red-500'
            id='packaging-quantity' inputMode='numeric' min={2} max={1000000} step={1} type='number' name='quantity' required value={values.quantity}
            onChange={(event) => setValues((previous) => ({ ...previous, quantity: event.target.value }))} />
          {state.errors.quantity && <p className='mt-2 text-sm text-red-700' id='packaging-quantity-error'>{state.errors.quantity}</p>}
        </div>
      </fieldset>
      <p aria-live='polite' className={styles.conversionPreview} id='packaging-preview'>{preview}</p>
      <EditingButtons pending={pending} onCancel={onCancel} />
    </form>
  );
};

const PackagingForm = ({
  baseUnitLabel,
  canCreatePackaging,
  canDeletePackaging,
  packagings,
  product,
}) => {
  const [packagingQuery, setPackagingQuery] = useState('');
  const [quantityFilter, setQuantityFilter] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const quantityUnitLabel = `${baseUnitLabel.toLocaleLowerCase('fr')}s`;
  const quantityOptions = useMemo(
    () => Array.from(new Set(packagings.map(({ quantity }) => quantity)))
      .sort((firstQuantity, secondQuantity) => firstQuantity - secondQuantity),
    [packagings],
  );
  const normalizedPackagingQuery = packagingQuery
    .trim()
    .toLocaleLowerCase('fr');
  const filteredPackagings = useMemo(
    () => packagings.filter((packaging) => {
      const matchesQuery = !normalizedPackagingQuery
        || packaging.label
          .toLocaleLowerCase('fr')
          .includes(normalizedPackagingQuery);
      const matchesQuantity = quantityFilter === 'ALL'
        || packaging.quantity === Number(quantityFilter);

      return matchesQuery && matchesQuantity;
    }),
    [normalizedPackagingQuery, packagings, quantityFilter],
  );
  const filtersActive = Boolean(
    normalizedPackagingQuery || quantityFilter !== 'ALL',
  );
  const totalPages = Math.max(
    1,
    Math.ceil(filteredPackagings.length / PACKAGINGS_PER_PAGE),
  );
  const activePage = Math.min(currentPage, totalPages);
  const firstPackagingIndex = (activePage - 1) * PACKAGINGS_PER_PAGE;
  const paginatedPackagings = filteredPackagings.slice(
    firstPackagingIndex,
    firstPackagingIndex + PACKAGINGS_PER_PAGE,
  );

  const resetFilters = () => {
    setPackagingQuery('');
    setQuantityFilter('ALL');
    setCurrentPage(1);
  };

  return (
    <>
      {canCreatePackaging && <EditableCard title='Ajouter une conversion' titleIcon={<ProductIcon name='box' />} description='Définissez un libellé et sa quantité en unités de base.'
        canEdit creation editLabel='Ajouter' editingLabel='Ajout en cours' formComponent={PackagingEditor} formProps={{ productId: product.id, quantityUnitLabel }} onSaved={resetFilters} />}
      <section className={`${styles.card} ${styles.packList}`} aria-labelledby='packagings-title'>
        <div className={styles.cardHead}><div className={styles.cardTitle}><ProductIcon name='box' /><h2 id='packagings-title'>Conditionnements définis</h2></div><span className={styles.pill}>{packagings.length} conversions</span></div>
        <div className={styles.filters} role='search'>
          <div className={styles.search}><ProductIcon name='search' /><label className='sr-only' htmlFor='packaging-search'>Rechercher un conditionnement</label>
            <input id='packaging-search' maxLength={100} placeholder='Rechercher par libellé' type='search' value={packagingQuery} onChange={(event) => { setPackagingQuery(event.target.value); setCurrentPage(1); }} /></div>
          <label className='sr-only' htmlFor='packaging-quantity-filter'>Filtrer par quantité de conversion</label>
          <select id='packaging-quantity-filter' value={quantityFilter} onChange={(event) => { setQuantityFilter(event.target.value); setCurrentPage(1); }}>
            <option value='ALL'>Toutes les conversions</option>{quantityOptions.map((quantity) => <option key={quantity} value={quantity}>{quantity} {quantityUnitLabel}</option>)}
          </select>
          {filtersActive && <button className={styles.reset} onClick={resetFilters} type='button'>Réinitialiser</button>}
        </div>
        {paginatedPackagings.length ? <ul>{paginatedPackagings.map((packaging) => <li className={styles.packRow} key={packaging.id}>
          <div className={styles.packLabel}><span className={styles.packIcon}><ProductIcon name='box' /></span><div><strong>{packaging.label}</strong><small>Conversion en unités de base</small></div></div>
          <p className={styles.conversion}>1 {packaging.label.toLocaleLowerCase('fr')} = <strong>{new Intl.NumberFormat('fr-DZ').format(packaging.quantity)}</strong> {quantityUnitLabel}</p>
          <div>{canDeletePackaging && <PackagingRemovalButton packaging={packaging} product={product} />}</div>
        </li>)}</ul> : <div className={styles.empty}><ProductIcon name='box' /><h3>{packagings.length ? 'Aucun conditionnement trouvé' : 'Aucun conditionnement défini'}</h3><p>{packagings.length ? 'Modifiez la recherche ou le filtre de conversion.' : 'Aucun pack, carton ou autre conditionnement n’est encore défini pour ce produit.'}</p>{filtersActive && <button className={styles.reset} onClick={resetFilters} type='button'>Voir tous les conditionnements</button>}</div>}
        <div className={styles.footer}><span>{filteredPackagings.length ? `${firstPackagingIndex + 1}–${firstPackagingIndex + paginatedPackagings.length}` : '0'} sur {filteredPackagings.length} conditionnements{filtersActive ? ` (${packagings.length} au total)` : ''}</span>
          <nav aria-label='Pagination des conditionnements' className={styles.pagination}>
            <button disabled={activePage === 1} onClick={() => setCurrentPage(activePage - 1)} type='button'>Précédent</button><span aria-live='polite'>Page {activePage} sur {totalPages}</span>
            <button disabled={activePage === totalPages} onClick={() => setCurrentPage(activePage + 1)} type='button'>Suivant</button>
          </nav>
        </div>
      </section>
      <p className={styles.help}>Une conversion ne crée pas de stock. Les quantités physiques restent exprimées en unités de base.</p>
    </>
  );
};

export default PackagingForm;
