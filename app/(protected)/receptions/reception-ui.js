'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { buildReceptionHistoryHref, readReceptionHistoryState } from '../../../lib/receptions.js';
import { EditingLink } from '../components/editing-session.js';
import styles from './receptions.module.css';

export const WorkspaceHeader = ({ activeTab, canReadReceptions, canReadSuppliers, children }) => {
  const parameters = useSearchParams();
  const historyHref = buildReceptionHistoryHref(readReceptionHistoryState(Object.fromEntries(parameters)));
  const supplierParameters = new URLSearchParams(historyHref.split('?')[1]);
  supplierParameters.set('onglet', 'fournisseurs');
  return (
    <>
      <header className={styles.hero}>
        <div><p className={styles.eyebrow}>Marchandises & partenaires</p><h1>Réceptions</h1><p>Retrouvez vos documents fournisseurs et préparez les entrées de marchandises.</p></div>
        {children}
      </header>
      <nav className={styles.tabs} aria-label='Sections des réceptions'>
        {canReadReceptions && <EditingLink aria-current={activeTab === 'receptions' ? 'page' : undefined} href={historyHref}>Réceptions</EditingLink>}
        {canReadSuppliers && <EditingLink aria-current={activeTab === 'fournisseurs' ? 'page' : undefined} href={`/receptions?${supplierParameters}`}>Fournisseurs</EditingLink>}
      </nav>
    </>
  );
};

export const Pagination = ({ page, totalPages, onChange, label, disabled = false }) => (
  <nav aria-label={label} className={styles.pagination}>
    <button disabled={disabled || page === 1} onClick={() => onChange(page - 1)} type='button'>Précédent</button>
    <span aria-live='polite'>Page {page} sur {totalPages}</span>
    <button disabled={disabled || page === totalPages} onClick={() => onChange(page + 1)} type='button'>Suivant</button>
  </nav>
);

export const ReadError = ({ children }) => {
  const router = useRouter();
  return <div className={styles.error} role='alert'><p>{children}</p><button onClick={() => router.refresh()} type='button'>Réessayer la lecture</button></div>;
};
