'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';

import {
  createSupplier,
  removeSupplier,
  updateSupplier,
} from './actions.js';
import SupplierForm from './supplier-form.js';

const SUPPLIERS_PER_PAGE = 10;
const EditSupplierDialog = ({ onClose, onSuccess, supplier }) => {
  const action = useMemo(
    () => updateSupplier.bind(null, supplier.id),
    [supplier.id],
  );

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby='edit-supplier-title'
        aria-modal='true'
        className='max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6'
        role='dialog'
      >
        <div className='flex items-start justify-between gap-4'>
          <div>
            <h3 className='text-xl font-semibold text-slate-900' id='edit-supplier-title'>
              Modifier le fournisseur
            </h3>
            <p className='mt-1 text-sm leading-6 text-slate-600'>
              Modifiez le nom ou les coordonnées de {supplier.name}.
            </p>
          </div>
          <button
            aria-label='Fermer la fenêtre de modification'
            className='inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            onClick={onClose}
            type='button'
          >
            <span aria-hidden='true' className='text-2xl leading-none'>×</span>
          </button>
        </div>

        <SupplierForm
          action={action}
          autoFocusName
          cancelLabel='Annuler'
          idPrefix='edit-supplier'
          initialValues={supplier}
          onCancel={onClose}
          onSuccess={onSuccess}
          pendingLabel='Enregistrement…'
          submitLabel='Enregistrer les modifications'
        />
      </section>
    </div>
  );
};

const RemoveSupplierDialog = ({ onClose, onSuccess, supplier }) => {
  const action = useMemo(
    () => removeSupplier.bind(null, supplier.id),
    [supplier.id],
  );
  const [state, formAction, pending] = useActionState(action, {
    error: null,
    message: null,
    revision: 0,
  });

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !pending) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, pending]);

  useEffect(() => {
    if (state.message) {
      onSuccess(state.message);
    }
  }, [onSuccess, state.message]);

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) {
          onClose();
        }
      }}
    >
      <section
        aria-describedby='remove-supplier-description'
        aria-labelledby='remove-supplier-title'
        aria-modal='true'
        className='w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl sm:p-6'
        role='dialog'
      >
        <h3 className='text-xl font-semibold text-slate-900' id='remove-supplier-title'>
          Retirer le fournisseur
        </h3>
        <div
          className='mt-3 space-y-3 text-sm leading-6 text-slate-600'
          id='remove-supplier-description'
        >
          <p>
            Vous allez retirer <strong className='text-slate-900'>{supplier.name}</strong>.
          </p>
          <p>
            S’il n’est lié à aucune réception, il sera supprimé. S’il appartient
            déjà à l’historique d’une réception, il sera uniquement désactivé.
          </p>
        </div>

        {state.error && (
          <p
            className='mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'
            role='alert'
          >
            {state.error}
          </p>
        )}

        <form action={formAction} className='mt-6 flex justify-end gap-3'>
          <button
            className='rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
            disabled={pending}
            onClick={onClose}
            type='button'
          >
            Annuler
          </button>
          <button
            className='rounded-lg bg-red-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-60'
            disabled={pending}
            type='submit'
          >
            {pending ? 'Retrait…' : 'Retirer le fournisseur'}
          </button>
        </form>
      </section>
    </div>
  );
};

const SupplierWorkspace = ({
  canCreateSupplier,
  canDeleteSupplier,
  canUpdateSupplier,
  suppliers,
}) => {
  const [formVisible, setFormVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [supplierToEdit, setSupplierToEdit] = useState(null);
  const [supplierToRemove, setSupplierToRemove] = useState(null);
  const [notice, setNotice] = useState(null);
  const canManageSuppliers = canDeleteSupplier || canUpdateSupplier;
  const normalizedQuery = query.trim().toLocaleLowerCase('fr');
  const filtersActive = Boolean(normalizedQuery || status !== 'ALL');
  const filteredSuppliers = useMemo(() => suppliers.filter((supplier) => {
    const searchableText = [
      supplier.name,
      supplier.contactName,
      supplier.phone,
      supplier.email,
      supplier.address,
    ].join(' ').toLocaleLowerCase('fr');
    const matchesQuery = !normalizedQuery
      || searchableText.includes(normalizedQuery);
    const matchesStatus = status === 'ALL'
      || (status === 'ACTIVE' ? supplier.active : !supplier.active);

    return matchesQuery && matchesStatus;
  }), [normalizedQuery, status, suppliers]);
  const totalPages = Math.max(
    1,
    Math.ceil(filteredSuppliers.length / SUPPLIERS_PER_PAGE),
  );
  const activePage = Math.min(currentPage, totalPages);
  const firstSupplierIndex = (activePage - 1) * SUPPLIERS_PER_PAGE;
  const paginatedSuppliers = filteredSuppliers.slice(
    firstSupplierIndex,
    firstSupplierIndex + SUPPLIERS_PER_PAGE,
  );

  const resetFilters = () => {
    setQuery('');
    setStatus('ALL');
    setCurrentPage(1);
  };

  const closeEditDialog = () => setSupplierToEdit(null);
  const handleSupplierUpdated = (message) => {
    setNotice(message);
    setSupplierToEdit(null);
  };
  const closeRemoveDialog = () => setSupplierToRemove(null);
  const handleSupplierRemoved = (message) => {
    setNotice(message);
    setSupplierToRemove(null);
  };

  return (
    <div role='tabpanel'>
      <div className='mt-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
        <div>
          <h2 className='text-xl font-semibold text-slate-900'>Fournisseurs</h2>
          <p className='mt-1 text-sm leading-6 text-slate-600'>
            Centralisez les coordonnées des partenaires qui livrent vos produits.
          </p>
        </div>
        {canCreateSupplier && (
          <button
            aria-expanded={formVisible}
            className='inline-flex w-fit items-center justify-center rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            onClick={() => setFormVisible((visible) => !visible)}
            type='button'
          >
            {formVisible ? 'Fermer le formulaire' : 'Nouveau fournisseur'}
          </button>
        )}
      </div>

      {canCreateSupplier && formVisible && (
        <section className='mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6'>
          <h3 className='text-lg font-semibold text-slate-900'>
            Créer un fournisseur
          </h3>
          <p className='mt-1 text-sm text-slate-600'>
            Seul le nom est obligatoire. Les coordonnées pourront être complétées
            plus tard.
          </p>
          <SupplierForm
            action={createSupplier}
            idPrefix='create-supplier'
            pendingLabel='Création…'
            submitLabel='Créer le fournisseur'
          />
        </section>
      )}

      {notice && (
        <p
          className='mt-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800'
          role='status'
        >
          {notice}
        </p>
      )}

      <section
        aria-labelledby='supplier-list-title'
        className='mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm'
      >
        <h3 className='sr-only' id='supplier-list-title'>Liste des fournisseurs</h3>
        <div className='border-b border-slate-200 p-4'>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-center' role='search'>
            <div className='flex-1'>
              <label className='sr-only' htmlFor='supplier-search'>
                Rechercher un fournisseur
              </label>
              <input
                className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
                id='supplier-search'
                maxLength={100}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setCurrentPage(1);
                }}
                placeholder='Rechercher par nom, contact ou coordonnées'
                type='search'
                value={query}
              />
            </div>
            <div className='sm:w-48'>
              <label className='sr-only' htmlFor='supplier-status'>
                Filtrer par état
              </label>
              <select
                className='w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-700 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
                id='supplier-status'
                onChange={(event) => {
                  setStatus(event.target.value);
                  setCurrentPage(1);
                }}
                value={status}
              >
                <option value='ALL'>Tous les états</option>
                <option value='ACTIVE'>Actifs</option>
                <option value='INACTIVE'>Désactivés</option>
              </select>
            </div>
          </div>
        </div>

        <div className='flex min-h-12 items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-6'>
          <p className='text-sm text-slate-500'>
            {filteredSuppliers.length > 0
              ? `${firstSupplierIndex + 1}–${firstSupplierIndex + paginatedSuppliers.length} sur ${filteredSuppliers.length} fournisseurs${filtersActive ? ` (${suppliers.length} au total)` : ''}`
              : `0 fournisseur${filtersActive ? ` sur ${suppliers.length}` : ''}`}
          </p>
          {filtersActive && (
            <button
              className='rounded-lg px-3 py-1.5 text-sm font-medium text-blue-700 transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
              onClick={resetFilters}
              type='button'
            >
              Réinitialiser
            </button>
          )}
        </div>

        {filteredSuppliers.length > 0 ? (
          <>
            <table className='w-full table-fixed divide-y divide-slate-200'>
              <caption className='sr-only'>Liste des fournisseurs</caption>
              <thead>
                <tr>
                  <th className='w-auto bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 sm:w-[30%] sm:px-6' scope='col'>
                    Fournisseur
                  </th>
                  <th className='hidden w-[22%] bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 sm:table-cell sm:px-6' scope='col'>
                    Contact
                  </th>
                  <th className='hidden w-auto bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 md:table-cell sm:px-6' scope='col'>
                    Coordonnées
                  </th>
                  <th className='w-24 bg-slate-50 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-6' scope='col'>
                    État
                  </th>
                  {canManageSuppliers && (
                    <th className='w-28 bg-slate-50 px-2 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 sm:w-40 sm:px-4' scope='col'>
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className='divide-y divide-slate-100 bg-white'>
                {paginatedSuppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td className='px-4 py-4 sm:px-6'>
                      <p className='break-words text-sm font-semibold text-slate-900'>
                        {supplier.name}
                      </p>
                      <div className='mt-1 space-y-0.5 text-xs text-slate-500 sm:hidden'>
                        {supplier.contactName && <p>{supplier.contactName}</p>}
                        {supplier.phone && <p>{supplier.phone}</p>}
                        {supplier.email && <p className='break-all'>{supplier.email}</p>}
                        {supplier.address && <p className='break-words'>{supplier.address}</p>}
                      </div>
                    </td>
                    <td className='hidden break-words px-4 py-4 text-sm text-slate-600 sm:table-cell sm:px-6'>
                      {supplier.contactName || '—'}
                    </td>
                    <td className='hidden px-4 py-4 text-sm text-slate-600 md:table-cell sm:px-6'>
                      {supplier.phone || supplier.email || supplier.address ? (
                        <div className='space-y-1'>
                          {supplier.phone && <p>{supplier.phone}</p>}
                          {supplier.email && <p className='break-all'>{supplier.email}</p>}
                          {supplier.address && <p className='break-words'>{supplier.address}</p>}
                        </div>
                      ) : '—'}
                    </td>
                    <td className='px-4 py-4 text-right sm:px-6'>
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${supplier.active ? 'border-green-200 bg-green-50 text-green-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                        {supplier.active ? 'Actif' : 'Désactivé'}
                      </span>
                    </td>
                    {canManageSuppliers && (
                      <td className='px-2 py-4 text-center sm:px-4'>
                        <div className='flex flex-col items-center justify-center gap-1 sm:flex-row'>
                          {canUpdateSupplier && (
                            <button
                              className='rounded-lg px-2 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
                              onClick={() => {
                                setNotice(null);
                                setSupplierToRemove(null);
                                setSupplierToEdit(supplier);
                              }}
                              type='button'
                            >
                              Modifier
                            </button>
                          )}
                          {canDeleteSupplier && supplier.active && (
                            <button
                              className='rounded-lg px-2 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700'
                              onClick={() => {
                                setNotice(null);
                                setSupplierToEdit(null);
                                setSupplierToRemove(supplier);
                              }}
                              type='button'
                            >
                              Retirer
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            <nav
              aria-label='Pagination des fournisseurs'
              className='flex items-center justify-between gap-4 border-t border-slate-200 px-4 py-3 sm:px-6'
            >
              <button
                className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40'
                disabled={activePage === 1}
                onClick={() => setCurrentPage(activePage - 1)}
                type='button'
              >
                Précédent
              </button>
              <p aria-live='polite' className='text-sm font-medium text-slate-600'>
                Page {activePage} sur {totalPages}
              </p>
              <button
                className='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40'
                disabled={activePage === totalPages}
                onClick={() => setCurrentPage(activePage + 1)}
                type='button'
              >
                Suivant
              </button>
            </nav>
          </>
        ) : (
          <div className='px-6 py-14 text-center'>
            <h4 className='font-semibold text-slate-900'>
              {filtersActive ? 'Aucun fournisseur trouvé' : 'Aucun fournisseur enregistré'}
            </h4>
            <p className='mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600'>
              {filtersActive
                ? 'Aucun fournisseur ne correspond à votre recherche et aux filtres actifs.'
                : 'Créez votre premier fournisseur pour préparer les prochaines réceptions.'}
            </p>
            {filtersActive ? (
              <button
                className='mt-5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50'
                onClick={resetFilters}
                type='button'
              >
                Voir tous les fournisseurs
              </button>
            ) : canCreateSupplier ? (
              <button
                className='mt-5 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800'
                onClick={() => setFormVisible(true)}
                type='button'
              >
                Créer un fournisseur
              </button>
            ) : null}
          </div>
        )}
      </section>

      {canUpdateSupplier && supplierToEdit && (
        <EditSupplierDialog
          key={supplierToEdit.id}
          onClose={closeEditDialog}
          onSuccess={handleSupplierUpdated}
          supplier={supplierToEdit}
        />
      )}
      {canDeleteSupplier && supplierToRemove && (
        <RemoveSupplierDialog
          key={supplierToRemove.id}
          onClose={closeRemoveDialog}
          onSuccess={handleSupplierRemoved}
          supplier={supplierToRemove}
        />
      )}
    </div>
  );
};

export default SupplierWorkspace;
