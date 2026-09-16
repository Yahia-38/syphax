'use client';

import { startTransition, useActionState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EditingSessionProvider, useEditingSession } from '../components/editing-session.js';
import ConfirmationDialog from '../confirmation-dialog.js';
import { createSupplier, removeSupplier, updateSupplier } from './actions.js';
import SupplierForm from './supplier-form.js';
import { Pagination, ReadError, WorkspaceHeader } from './reception-ui.js';
import styles from './receptions.module.css';

const SupplierEditor = ({ supplier, onCancel, onSuccess }) => {
  const action = useMemo(() => supplier ? updateSupplier.bind(null, supplier.id) : createSupplier, [supplier]);
  return <div className={styles.supplierForm}>
    <div className={styles.supplierEditorHeader}>
      <h3>{supplier ? `Modifier ${supplier.name}` : 'Nouveau fournisseur'}</h3>
      {supplier && <span className={`${styles.badge} ${supplier.active ? styles.green : ''}`}>{supplier.active ? 'Actif' : 'Désactivé'}</span>}
    </div>
    <p>Seul le nom est obligatoire.</p>
    <SupplierForm action={action} autoFocusName idPrefix={supplier ? `supplier-${supplier.id}` : 'create-supplier'}
      initialValues={supplier ?? undefined} onCancel={onCancel} onSuccess={onSuccess} cancelLabel='Annuler'
      pendingLabel='Enregistrement…' submitLabel={supplier ? 'Enregistrer' : 'Créer le fournisseur'} />
  </div>;
};

const RemoveSupplierDialog = ({ supplier, onClose, onSuccess, onError }) => {
  const action = useMemo(() => removeSupplier.bind(null, supplier.id), [supplier.id]);
  const [state, dispatch, pending] = useActionState(async (previous) => {
    try { return await action(previous); }
    catch { return { error: 'La réponse au retrait n’a pas pu être confirmée. Vérifiez la liste avant de réessayer.', message: null, revision: previous.revision + 1 }; }
  }, { error: null, message: null, revision: 0 });
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const lockedRef = useRef(false);
  const session = useEditingSession();
  const register = session?.register;
  const activeRef = useRef({ dirty: false, pending: false, discard: onClose });
  useLayoutEffect(() => {
    triggerRef.current = document.activeElement;
    dialogRef.current?.showModal();
    return register?.(activeRef.current);
  }, [register]);
  useEffect(() => {
    if (pending || !state.revision) return;
    lockedRef.current = false;
    activeRef.current.pending = false;
    if (state.message) {
      dialogRef.current?.close();
      onSuccess(state.message);
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
    else if (state.error) { onError(state.error); dialogRef.current?.close(); }
  }, [state, pending, onSuccess, onError]);
  return <ConfirmationDialog dialogRef={dialogRef} title='Retirer ce fournisseur ?' tone='red'
    confirmType='button' confirmLabel='Retirer le fournisseur' pendingLabel='Retrait…' pending={pending}
    onClose={() => { onClose(); requestAnimationFrame(() => triggerRef.current?.focus()); }}
    onConfirm={() => {
      if (lockedRef.current) return;
      lockedRef.current = true;
      activeRef.current.pending = true;
      startTransition(() => dispatch());
    }}>
    <p>Vous allez retirer <strong>{supplier.name}</strong>.</p>
    <p>Sans utilisation historique, il pourra être supprimé. S’il est déjà référencé, ou le devient pendant le retrait, il sera désactivé pour préserver l’historique.</p>
  </ConfirmationDialog>;
};

const SupplierContent = ({ canCreateSupplier, canDeleteSupplier, canUpdateSupplier, canReadReceptions, canReadSuppliers, suppliers, readError }) => {
  const session = useEditingSession();
  const [target, setTarget] = useState(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [supplierToRemove, setSupplierToRemove] = useState(null);
  const [notice, setNotice] = useState(null);
  const [removeError, setRemoveError] = useState(null);
  const focusRef = useRef(null);
  const normalizedQuery = query.trim().toLocaleLowerCase('fr');
  const filtersActive = Boolean(normalizedQuery || status !== 'ALL');
  const filteredSuppliers = useMemo(() => suppliers.filter((supplier) => {
    const text = [supplier.name, supplier.contactName, supplier.phone, supplier.email, supplier.address].join(' ').toLocaleLowerCase('fr');
    return (!normalizedQuery || text.includes(normalizedQuery)) && (status === 'ALL' || (status === 'ACTIVE' ? supplier.active : !supplier.active));
  }), [normalizedQuery, status, suppliers]);
  const totalPages = Math.max(1, Math.ceil(filteredSuppliers.length / 10));
  const activePage = Math.min(currentPage, totalPages);
  const firstIndex = (activePage - 1) * 10;
  const paginatedSuppliers = filteredSuppliers.slice(firstIndex, firstIndex + 10);
  const edit = (nextTarget, event) => {
    const trigger = event.currentTarget;
    session.request(() => { focusRef.current = trigger; setNotice(null); setTarget(nextTarget); });
  };
  const cancel = useCallback(() => { setTarget(null); requestAnimationFrame(() => focusRef.current?.focus()); }, []);
  const saved = useCallback((message) => { cancel(); setNotice(message); }, [cancel]);
  const removed = useCallback((message) => { setSupplierToRemove(null); setNotice(message); }, []);
  const removalFailed = useCallback((message) => { setRemoveError(message); }, []);
  const closeRemove = useCallback(() => setSupplierToRemove(null), []);
  const changeList = (proceed) => session.request(proceed);
  const resetFilters = () => changeList(() => { setQuery(''); setStatus('ALL'); setCurrentPage(1); });

  return <div className={styles.workspace}>
    <WorkspaceHeader activeTab='fournisseurs' canReadReceptions={canReadReceptions} canReadSuppliers={canReadSuppliers}>
      {canCreateSupplier && target === null && <button className={styles.primary} onClick={(event) => edit('new', event)} type='button'>Nouveau fournisseur</button>}
    </WorkspaceHeader>
    {notice && <p className={styles.notice} role='status'>{notice}</p>}
    {removeError && <p className={styles.error} role='alert'>{removeError}</p>}
    {canCreateSupplier && target === 'new' && <section className={`${styles.card} ${styles.editing} ${styles.newSupplier}`}><SupplierEditor onCancel={cancel} onSuccess={saved} /></section>}
    <div className={styles.sectionLabel}><h2 id='supplier-list-title'>Fournisseurs</h2><p>Coordonnées et disponibilité pour les prochaines réceptions.</p></div>
    <section className={styles.card} aria-labelledby='supplier-list-title'>
      <form className={styles.compactFilters} key={`${query}:${status}`} role='search' onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        changeList(() => { setQuery(String(data.get('query')).trim()); setStatus(String(data.get('status'))); setCurrentPage(1); });
      }}>
        <div><label htmlFor='supplier-search'>Rechercher</label><input id='supplier-search' name='query' type='search' placeholder='Nom, contact ou coordonnées' maxLength={100} defaultValue={query} /></div>
        <div><label htmlFor='supplier-status'>Statut</label><select id='supplier-status' name='status' defaultValue={status}><option value='ALL'>Tous</option><option value='ACTIVE'>Actifs</option><option value='INACTIVE'>Désactivés</option></select></div>
        <button className={styles.primary} type='submit'>Rechercher</button>
      </form>
      <div className={styles.band}><p>{readError ? 'Lecture indisponible' : `${filteredSuppliers.length} fournisseur${filteredSuppliers.length > 1 ? 's' : ''}`}</p>{filtersActive && <button onClick={resetFilters} type='button'>Réinitialiser</button>}</div>
      {readError && <div className='px-5'><ReadError>{readError}</ReadError></div>}
      {!readError && !filteredSuppliers.length && <div className={styles.empty}><h3>{filtersActive ? 'Aucun fournisseur trouvé' : 'Aucun fournisseur enregistré'}</h3><p>{filtersActive ? 'Essayez une autre recherche ou un autre statut.' : 'Créez un partenaire pour préparer les prochaines réceptions.'}</p>{filtersActive ? <button className={styles.secondary} onClick={resetFilters} type='button'>Voir tous les fournisseurs</button> : canCreateSupplier && <button className={styles.secondary} onClick={(event) => edit('new', event)} type='button'>Créer un fournisseur</button>}</div>}
    </section>
    {!readError && <div className={styles.supplierCards}>
      {paginatedSuppliers.map((supplier) => <section className={`${styles.card} ${target === supplier.id ? styles.editing : ''}`} key={supplier.id} aria-label={supplier.name}>
        {target === supplier.id && canUpdateSupplier ? <SupplierEditor supplier={supplier} onCancel={cancel} onSuccess={saved} /> : <div className={styles.supplierOverview}>
          <div><h3>{supplier.name}</h3><span className={`${styles.badge} ${supplier.active ? styles.green : ''}`}>{supplier.active ? 'Actif' : 'Désactivé'}</span><p>{supplier.contactName ? `Contact : ${supplier.contactName}` : 'Contact non renseigné'}</p></div>
          <div><p>{supplier.phone || 'Téléphone non renseigné'}</p><p>{supplier.email || 'E-mail non renseigné'}</p>{supplier.address && <details><summary>Voir l’adresse</summary><p className='whitespace-pre-wrap'>{supplier.address}</p></details>}</div>
          <div className={styles.supplierActions}>
            {canUpdateSupplier && target !== supplier.id && <button className={styles.secondary} onClick={(event) => edit(supplier.id, event)} type='button'>Modifier</button>}
            {canDeleteSupplier && target !== supplier.id && <button className={styles.danger} onClick={() => session.request(() => { setNotice(null); setRemoveError(null); setSupplierToRemove(supplier); })} type='button'>Retirer</button>}
          </div>
        </div>}
      </section>)}
      {filteredSuppliers.length > 0 && <Pagination page={activePage} totalPages={totalPages} totalResults={filteredSuppliers.length} label='Pagination des fournisseurs' onChange={(page) => changeList(() => setCurrentPage(page))} />}
      <p className={styles.supplierHelp}>Un fournisseur déjà utilisé est désactivé lorsqu’il est retiré. Les réceptions conservent leur historique.</p>
    </div>}
    {canDeleteSupplier && supplierToRemove && <RemoveSupplierDialog key={supplierToRemove.id} supplier={supplierToRemove} onClose={closeRemove} onSuccess={removed} onError={removalFailed} />}
  </div>;
};

const SupplierWorkspace = (props) => <EditingSessionProvider protectNavigation operation discardDescription='La saisie sera fermée et ses changements locaux seront abandonnés. Après une tentative d’enregistrement sans réponse confirmée, vérifiez la liste avant de recommencer.'><SupplierContent {...props} /></EditingSessionProvider>;
export default SupplierWorkspace;
